import type { Request, Response } from "express";
import { getDemoConfig } from "../config/demo-config.js";
import { indexDemoRepository } from "../ingestion/services/repository-service.js";
import { validateRepositoryName } from "../ingestion/services/repository-storage.js";
import { pool } from "../config/database.js";
import { cleanupDemoSession } from "./demo-cleanup-service.js";
import { DemoRequestError, verifyPublicGitHubRepository } from "./github-repository.js";
import { activateDemoSession, clearedDemoSessionCookie, createDemoSession, demoSessionCookie, getDemoSessionRepository, markDemoSessionForCleanup } from "./demo-session-service.js";

function respondError(res: Response, error: unknown): Response {
    if (error instanceof DemoRequestError) {
        if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
        return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof Error && error.message.includes("time limit")) {
        return res.status(504).json({ error: { code: "DEMO_INDEX_TIMEOUT", message: "Indexing took too long. Try a smaller repository." } });
    }
    if (error instanceof Error && (error.message.includes("demo limit") || error.message.includes("demo size limit") || error.message.includes("demo file or source-size limit") || error.message.includes("demo filesystem-entry limit"))) {
        return res.status(413).json({ error: { code: "DEMO_RESOURCE_LIMIT", message: error.message } });
    }
    return res.status(502).json({ error: { code: "DEMO_INDEX_FAILED", message: "The repository could not be indexed for this demo. Check that it is public and try a smaller repository." } });
}

export async function createDemoSessionHandler(req: Request, res: Response): Promise<Response> {
    const config = getDemoConfig();
    if (!config.enabled) return res.status(404).json({ error: { code: "DEMO_DISABLED", message: "The anonymous demo is unavailable." } });
    let verified;
    try {
        verified = await verifyPublicGitHubRepository(req.body?.url, config.maxRepositorySizeMb * 1024 * 1024);
        validateRepositoryName(verified.name);
    } catch (error) {
        return respondError(res, error);
    }

    let lease: Awaited<ReturnType<typeof createDemoSession>> | null = null;
    try {
        lease = await createDemoSession(config);
        const indexed = await indexDemoRepository(verified.name, verified.cloneUrl, lease.sessionId, {
            maxFiles: config.maxFiles,
            maxFilesystemEntries: config.maxFilesystemEntries,
            maxFileBytes: config.maxFileSizeMb * 1024 * 1024,
            maxRepositoryBytes: config.maxRepositorySizeMb * 1024 * 1024,
            maxDurationMs: config.maxIndexDurationSeconds * 1000
        });
        if (!await activateDemoSession(lease.sessionId)) throw new Error("Demo session could not be activated after indexing");
        const repository = await getDemoSessionRepository(lease.sessionId);
        if (!repository) throw new Error("Indexed demo repository could not be loaded");
        const remainingSeconds = Math.max(1, Math.floor((Date.parse(lease.expiresAt) - Date.now()) / 1000));
        res.append("Set-Cookie", demoSessionCookie(lease.token, remainingSeconds));
        const payload = { ...repository, indexing: {
            fileCount: indexed.fileCount,
            symbolCount: indexed.symbolCount,
            relationshipCount: indexed.relationshipCount,
            chunkCount: indexed.chunkCount
        } };
        await lease.release();
        lease = null;
        return res.status(201).json(payload);
    } catch (error) {
        if (lease) {
            await markDemoSessionForCleanup(lease.sessionId).catch(() => undefined);
            await lease.release();
            await cleanupDemoSession(lease.sessionId, true);
        }
        return respondError(res, error);
    } finally {
        if (lease) await lease.release();
    }
}

export async function getDemoSessionHandler(req: Request, res: Response): Promise<Response> {
    if (!req.demoSessionId) return res.status(401).json({ error: { code: "DEMO_SESSION_REQUIRED", message: "Start a demo session to continue." } });
    try {
        const workspace = await getDemoSessionRepository(req.demoSessionId);
        if (!workspace) return res.status(410).json({ error: { code: "DEMO_SESSION_EXPIRED", message: "This demo session has expired. Start a new demo to continue." } });
        return res.json(workspace);
    } catch {
        return res.status(503).json({ error: { code: "DEMO_SESSION_UNAVAILABLE", message: "Demo session could not be loaded." } });
    }
}

export async function endDemoSessionHandler(req: Request, res: Response): Promise<Response> {
    if (!req.demoSessionId) return res.status(401).json({ error: { code: "DEMO_SESSION_REQUIRED", message: "Start a demo session to continue." } });
    try {
        await markDemoSessionForCleanup(req.demoSessionId);
        res.append("Set-Cookie", clearedDemoSessionCookie());
        return res.status(202).json({ ended: true, cleanup: "scheduled" });
    } catch {
        return res.status(503).json({ error: { code: "DEMO_END_FAILED", message: "The demo session could not be ended right now." } });
    }
}

export async function getDemoRepositoryHandler(req: Request, res: Response): Promise<Response> {
    const sessionId = req.demoSessionId;
    if (!sessionId) return res.status(401).json({ error: { code: "DEMO_SESSION_REQUIRED", message: "Start a demo session to continue." } });
    try {
        const workspace = await getDemoSessionRepository(sessionId);
        if (!workspace || workspace.repository.repositoryId !== req.params.repositoryId) {
            return res.status(404).json({ error: { code: "DEMO_REPOSITORY_NOT_FOUND", message: "Demo repository was not found." } });
        }
        return res.json({ repository: workspace.repository, session: workspace.session });
    } catch {
        return res.status(503).json({ error: { code: "DEMO_REPOSITORY_UNAVAILABLE", message: "Demo repository could not be loaded." } });
    }
}

export async function listDemoFilesHandler(req: Request, res: Response): Promise<Response> {
    const repositoryId = req.params.repositoryId;
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 100 : Number(req.query.pageSize);
    if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
        return res.status(400).json({ error: { code: "INVALID_PAGINATION", message: "page and pageSize are outside the allowed range." } });
    }
    try {
        const result = await pool.query<{
            id: string; path: string; language: string | null; size: string | null; startLine: number | null; endLine: number | null;
        }>(
            `SELECT f.id, f.path, f.language, f.size::text AS size,
                    MIN(s.start_line) AS "startLine", MAX(s.end_line) AS "endLine"
             FROM files f LEFT JOIN symbols s ON s.file_id = f.id AND s.repository_id = f.repository_id
             WHERE f.repository_id = $1
             GROUP BY f.id, f.path, f.language, f.size
             ORDER BY f.path, f.id LIMIT $2 OFFSET $3`,
            [repositoryId, pageSize, (page - 1) * pageSize]
        );
        const count = await pool.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM files WHERE repository_id = $1", [repositoryId]);
        return res.json({ repositoryId, page, pageSize, totalCount: Number(count.rows[0]?.total ?? 0), files: result.rows.map(row => ({
            id: row.id, path: row.path, language: row.language, size: row.size === null ? null : Number(row.size),
            startLine: row.startLine, endLine: row.endLine
        })) });
    } catch {
        return res.status(503).json({ error: { code: "DEMO_FILES_UNAVAILABLE", message: "Repository files could not be loaded." } });
    }
}
