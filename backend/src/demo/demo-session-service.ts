import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../config/database.js";
import type { DemoConfig } from "../config/demo-config.js";
import { DemoRequestError } from "./github-repository.js";

const ADMISSION_LOCK_NAMESPACE = 830174;
const INDEX_LOCK_NAMESPACE = 830175;
const SESSION_LOCK_SEED = 830176;
const SESSION_COOKIE_NAME = "repo_ai_demo";

export interface DemoSessionLease {
    sessionId: string;
    token: string;
    expiresAt: string;
    release: () => Promise<void>;
}

export function hashDemoToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export async function createDemoSession(config: DemoConfig): Promise<DemoSessionLease> {
    const client = await pool.connect();
    let indexSlot: number | null = null;
    let sessionId: string | null = null;
    let released = false;

    const release = async () => {
        if (released) return;
        released = true;
        if (sessionId) await client.query("SELECT pg_advisory_unlock_shared(hashtextextended($1, $2))", [sessionId, SESSION_LOCK_SEED]).catch(() => undefined);
        if (indexSlot !== null) await client.query("SELECT pg_advisory_unlock($1, $2)", [INDEX_LOCK_NAMESPACE, indexSlot]).catch(() => undefined);
        client.release();
    };

    try {
        for (let slot = 0; slot < config.maxConcurrentIndexes; slot += 1) {
            const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1, $2) AS locked", [INDEX_LOCK_NAMESPACE, slot]);
            if (result.rows[0]?.locked) { indexSlot = slot; break; }
        }
        if (indexSlot === null) throw new DemoRequestError(429, "Demo indexing is busy. Please try again shortly.", "DEMO_INDEX_CAPACITY");

        const token = randomBytes(32).toString("base64url");
        const tokenHash = hashDemoToken(token);
        sessionId = randomUUID();
        await client.query("SELECT pg_advisory_lock_shared(hashtextextended($1, $2))", [sessionId, SESSION_LOCK_SEED]);

        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1, $2)", [ADMISSION_LOCK_NAMESPACE, 0]);
        const active = await client.query<{ count: string }>(
            "SELECT COUNT(*)::text AS count FROM demo_sessions"
        );
        if (Number(active.rows[0]?.count ?? 0) >= config.maxActiveSessions) {
            await client.query("ROLLBACK");
            throw new DemoRequestError(429, "All anonymous demo sessions are currently in use. Please try again later.", "DEMO_SESSION_CAPACITY");
        }
        const inserted = await client.query<{ expiresAt: Date }>(
            `INSERT INTO demo_sessions (id, token_hash, status, indexing_started_at, expires_at)
             VALUES ($1, $2, 'INDEXING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'))
             RETURNING expires_at AS "expiresAt"`,
            [sessionId, tokenHash, config.sessionTtlMinutes]
        );
        await client.query("COMMIT");
        return { sessionId, token, expiresAt: inserted.rows[0].expiresAt.toISOString(), release };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        await release();
        throw error;
    }
}

export async function activateDemoSession(sessionId: string): Promise<boolean> {
    const result = await pool.query(
        `UPDATE demo_sessions SET status = 'ACTIVE', indexing_started_at = NULL
         WHERE id = $1 AND status = 'INDEXING' AND expires_at > CURRENT_TIMESTAMP
           AND EXISTS (SELECT 1 FROM repositories r WHERE r.demo_session_id = $1 AND r.owner_user_id IS NULL AND r.indexed_at IS NOT NULL)`,
        [sessionId]
    );
    return (result.rowCount ?? 0) === 1;
}

export async function markDemoSessionForCleanup(sessionId: string): Promise<void> {
    await pool.query(
        `UPDATE demo_sessions SET status = 'DELETING', cleanup_started_at = COALESCE(cleanup_started_at, CURRENT_TIMESTAMP)
         WHERE id = $1`,
        [sessionId]
    );
}

export async function getDemoSessionRepository(sessionId: string) {
    const result = await pool.query<{
        repositoryId: string; name: string; url: string | null; createdAt: Date; indexedAt: Date | null;
        fileCount: string; symbolCount: string; expiresAt: Date;
    }>(
        `SELECT r.id AS "repositoryId", r.name, r.url, r.created_at AS "createdAt", r.indexed_at AS "indexedAt",
                ds.expires_at AS "expiresAt",
                (SELECT COUNT(*)::text FROM files f WHERE f.repository_id = r.id) AS "fileCount",
                (SELECT COUNT(*)::text FROM symbols s WHERE s.repository_id = r.id) AS "symbolCount"
         FROM demo_sessions ds
         JOIN repositories r ON r.demo_session_id = ds.id AND r.owner_user_id IS NULL
         WHERE ds.id = $1 AND ds.status = 'ACTIVE' AND ds.expires_at > CURRENT_TIMESTAMP`,
        [sessionId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
        session: { expiresAt: row.expiresAt.toISOString() },
        repository: {
            repositoryId: row.repositoryId,
            name: row.name,
            url: row.url,
            indexingStatus: row.indexedAt ? "INDEXED" as const : "NOT_INDEXED" as const,
            fileCount: Number(row.fileCount),
            symbolCount: Number(row.symbolCount),
            createdAt: row.createdAt.toISOString(),
            indexedAt: row.indexedAt?.toISOString() ?? null
        }
    };
}

export function demoSessionCookie(token: string, maxAgeSeconds: number): string {
    const secure = process.env.NODE_ENV === "production";
    const sameSite = secure ? "None" : "Lax";
    return `${SESSION_COOKIE_NAME}=${token}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; Path=/api/demo; HttpOnly; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
}

export function clearedDemoSessionCookie(): string {
    const secure = process.env.NODE_ENV === "production";
    return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/api/demo; HttpOnly; SameSite=${secure ? "None" : "Lax"}${secure ? "; Secure" : ""}`;
}

export function demoCookieToken(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
        const value = part.slice(separator + 1).trim();
        return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
    }
    return null;
}

export async function findDemoSessionIdByToken(token: string): Promise<string | null> {
    const result = await pool.query<{ id: string }>("SELECT id FROM demo_sessions WHERE token_hash = $1", [hashDemoToken(token)]);
    return result.rows[0]?.id ?? null;
}

export async function lockDemoSessionShared(client: PoolClient, sessionId: string): Promise<void> {
    await client.query("SELECT pg_advisory_lock_shared(hashtextextended($1, $2))", [sessionId, SESSION_LOCK_SEED]);
}

export async function unlockDemoSessionShared(client: PoolClient, sessionId: string): Promise<void> {
    await client.query("SELECT pg_advisory_unlock_shared(hashtextextended($1, $2))", [sessionId, SESSION_LOCK_SEED]);
}
