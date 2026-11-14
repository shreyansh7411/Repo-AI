import type { NextFunction, Request, Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "../config/database.js";
import { getDemoConfig } from "../config/demo-config.js";
import { DemoRequestError } from "./github-repository.js";
import { demoCookieToken, findDemoSessionIdByToken, hashDemoToken, lockDemoSessionShared, unlockDemoSessionShared, clearedDemoSessionCookie } from "./demo-session-service.js";
import { enforceDemoRateLimit } from "./demo-rate-limit.js";

declare global {
    namespace Express {
        interface Request {
            demoSessionId?: string;
        }
    }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(res: Response, error: DemoRequestError): void {
    if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
}

export function requireDemoOrigin(req: Request, res: Response, next: NextFunction): void {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
    const origin = req.get("origin");
    const configuredOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
    const localOrigin = typeof origin === "string" && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin);
    if (!origin || (origin !== configuredOrigin && !(process.env.NODE_ENV !== "production" && localOrigin))) {
        res.status(403).json({ error: { code: "DEMO_ORIGIN_REJECTED", message: "This request origin is not allowed." } });
        return;
    }
    if (!req.is("application/json")) {
        res.status(415).json({ error: { code: "JSON_REQUIRED", message: "Demo requests must use JSON." } });
        return;
    }
    next();
}

export async function demoRateLimit(action: "index" | "read", req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!getDemoConfig().enabled) {
            res.status(404).json({ error: { code: "DEMO_DISABLED", message: "The anonymous demo is unavailable." } });
            return;
        }
        await enforceLimit(req, action);
        next();
    } catch (error) {
        if (error instanceof DemoRequestError) { fail(res, error); return; }
        res.status(503).json({ error: { code: "DEMO_RATE_LIMIT_UNAVAILABLE", message: "Demo requests are temporarily unavailable." } });
    }
}

export async function demoSessionRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.demoSessionId) {
        res.status(401).json({ error: { code: "DEMO_SESSION_REQUIRED", message: "Start a demo session to continue." } });
        return;
    }
    try {
        await enforceDemoRateLimit(req, "read", req.demoSessionId);
        next();
    } catch (error) {
        if (error instanceof DemoRequestError) { fail(res, error); return; }
        res.status(503).json({ error: { code: "DEMO_RATE_LIMIT_UNAVAILABLE", message: "Demo requests are temporarily unavailable." } });
    }
}

async function enforceLimit(req: Request, action: "index" | "read"): Promise<void> {
    await enforceDemoRateLimit(req, action);
}

export async function requireDemoSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    let client: PoolClient | null = null;
    let locked = false;
    let sessionId: string | null = null;
    try {
        if (!getDemoConfig().enabled) {
            res.status(404).json({ error: { code: "DEMO_DISABLED", message: "The anonymous demo is unavailable." } });
            return;
        }
        const token = demoCookieToken(req.headers.cookie);
        if (!token) {
            res.status(401).json({ error: { code: "DEMO_SESSION_REQUIRED", message: "Start a demo session to continue." } });
            return;
        }
        sessionId = await findDemoSessionIdByToken(token);
        if (!sessionId) {
            res.append("Set-Cookie", clearedDemoSessionCookie());
            res.status(401).json({ error: { code: "DEMO_SESSION_REQUIRED", message: "Start a demo session to continue." } });
            return;
        }
        client = await pool.connect();
        await lockDemoSessionShared(client, sessionId);
        locked = true;
        const state = await client.query<{ status: string; expired: boolean }>(
            `SELECT status, expires_at <= CURRENT_TIMESTAMP AS expired
             FROM demo_sessions WHERE id = $1 AND token_hash = $2`,
            [sessionId, hashDemoToken(token)]
        );
        const row = state.rows[0];
        if (!row || row.status !== "ACTIVE" || row.expired) {
            await unlockDemoSessionShared(client, sessionId);
            locked = false;
            client.release();
            client = null;
            res.append("Set-Cookie", clearedDemoSessionCookie());
            res.status(row?.expired ? 410 : 401).json({ error: {
                code: row?.expired ? "DEMO_SESSION_EXPIRED" : "DEMO_SESSION_REQUIRED",
                message: row?.expired ? "This demo session has expired. Start a new demo to continue." : "Start a demo session to continue."
            } });
            return;
        }
        req.demoSessionId = sessionId;
        const lockedClient = client;
        const activeSessionId = sessionId;
        let released = false;
        const release = async () => {
            if (released) return;
            released = true;
            if (locked && lockedClient) {
                await unlockDemoSessionShared(lockedClient, activeSessionId).catch(() => undefined);
                lockedClient.release();
            }
        };
        res.once("finish", () => { void release(); });
        res.once("close", () => { void release(); });
        next();
    } catch {
        if (client) {
            if (locked && sessionId) await unlockDemoSessionShared(client, sessionId).catch(() => undefined);
            client.release();
        }
        res.status(503).json({ error: { code: "DEMO_SESSION_UNAVAILABLE", message: "Demo session could not be verified." } });
    }
}

export async function requireDemoRepository(req: Request, res: Response, next: NextFunction): Promise<void> {
    const value = req.params.repositoryId;
    const repositoryId = Array.isArray(value) ? value[0] : value;
    if (!repositoryId || !uuidPattern.test(repositoryId)) {
        res.status(400).json({ error: { code: "INVALID_REPOSITORY_ID", message: "A valid repositoryId is required." } });
        return;
    }
    if (!req.demoSessionId) {
        res.status(401).json({ error: { code: "DEMO_SESSION_REQUIRED", message: "Start a demo session to continue." } });
        return;
    }
    try {
        const result = await pool.query(
            `SELECT 1 FROM repositories r JOIN demo_sessions ds ON ds.id = r.demo_session_id
             WHERE r.id = $1 AND r.demo_session_id = $2 AND r.owner_user_id IS NULL
               AND ds.status = 'ACTIVE' AND ds.expires_at > CURRENT_TIMESTAMP`,
            [repositoryId, req.demoSessionId]
        );
        if ((result.rowCount ?? 0) === 0) {
            res.status(404).json({ error: { code: "DEMO_REPOSITORY_NOT_FOUND", message: "Demo repository was not found." } });
            return;
        }
        next();
    } catch {
        res.status(503).json({ error: { code: "DEMO_REPOSITORY_UNAVAILABLE", message: "Demo repository access could not be verified." } });
    }
}
