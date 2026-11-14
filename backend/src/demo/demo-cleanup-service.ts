import { rm, stat } from "node:fs/promises";
import { pool } from "../config/database.js";
import { getDemoConfig } from "../config/demo-config.js";
import { getDemoRepositoryClonePath } from "../ingestion/services/repository-storage.js";

const SESSION_LOCK_SEED = 830176;
let cleanupTimer: NodeJS.Timeout | null = null;
let sweepRunning = false;

export async function reconcileDemoSessions(): Promise<void> {
    const sessions = await pool.query<{ sessionId: string; repositoryId: string | null }>(
        `SELECT ds.id AS "sessionId", r.id AS "repositoryId"
         FROM demo_sessions ds
         LEFT JOIN repositories r ON r.demo_session_id = ds.id AND r.owner_user_id IS NULL
         WHERE ds.status IN ('ACTIVE', 'INDEXING')
         ORDER BY ds.id`
    );

    for (const session of sessions.rows) {
        if (session.repositoryId && await demoCloneExists(session.repositoryId)) continue;

        await cleanupDemoSession(session.sessionId, true);
    }
}

async function demoCloneExists(repositoryId: string): Promise<boolean> {
    try {
        return (await stat(getDemoRepositoryClonePath(repositoryId))).isDirectory();
    } catch (error) {
        if (isMissingPathError(error)) return false;
        throw error;
    }
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error
        && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

export async function cleanupDemoSession(sessionId: string, force = false): Promise<boolean> {
    const client = await pool.connect();
    let locked = false;
    try {
        const lockResult = await client.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended($1, $2)) AS locked",
            [sessionId, SESSION_LOCK_SEED]
        );
        locked = lockResult.rows[0]?.locked === true;
        if (!locked) {
            console.error(`Demo session cleanup deferred because its advisory lock is unavailable: ${sessionId}.`);
            return false;
        }

        const session = await client.query<{ status: string; eligible: boolean }>(
            `SELECT status,
                ($2::boolean OR status = 'DELETING'
                  OR (status = 'ACTIVE' AND expires_at <= CURRENT_TIMESTAMP)
                  OR (status = 'INDEXING' AND indexing_started_at <= CURRENT_TIMESTAMP - ($3 * INTERVAL '1 second'))) AS eligible
             FROM demo_sessions WHERE id = $1`,
            [sessionId, force, getDemoConfig().maxIndexDurationSeconds + 30]
        );
        const row = session.rows[0];
        if (!row || !row.eligible) return false;

        await client.query("UPDATE demo_sessions SET status = 'DELETING', cleanup_started_at = COALESCE(cleanup_started_at, CURRENT_TIMESTAMP) WHERE id = $1", [sessionId]);
        const repositories = await client.query<{ id: string }>("SELECT id FROM repositories WHERE demo_session_id = $1", [sessionId]);
        for (const repository of repositories.rows) {
            try {
                await rm(getDemoRepositoryClonePath(repository.id), { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
            } catch {
                console.error("Demo clone cleanup will be retried by the cleanup worker.");
                return false;
            }
        }

        await client.query("BEGIN");
        await client.query("DELETE FROM demo_sessions WHERE id = $1 AND status = 'DELETING'", [sessionId]);
        await client.query("COMMIT");
        return true;
    } catch {
        await client.query("ROLLBACK").catch(() => undefined);
        console.error("Demo session cleanup failed and will be retried.");
        return false;
    } finally {
        if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, $2))", [sessionId, SESSION_LOCK_SEED]).catch(() => undefined);
        client.release();
    }
}

export async function sweepExpiredDemoData(): Promise<void> {
    const config = getDemoConfig();
    if (sweepRunning) return;
    sweepRunning = true;
    try {
        const candidates = await pool.query<{ id: string }>(
            `SELECT id FROM demo_sessions
             WHERE status = 'DELETING'
                OR (status = 'ACTIVE' AND expires_at <= CURRENT_TIMESTAMP)
                OR (status = 'INDEXING' AND indexing_started_at <= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second'))
             ORDER BY expires_at, id LIMIT 25`,
            [config.maxIndexDurationSeconds + 30]
        );
        for (const candidate of candidates.rows) await cleanupDemoSession(candidate.id);

        await pool.query("DELETE FROM demo_rate_limits WHERE expires_at <= CURRENT_TIMESTAMP");
    } catch {
        console.error("Demo cleanup sweep failed and will be retried.");
    } finally {
        sweepRunning = false;
    }
}

export function startDemoCleanupWorker(): void {
    const config = getDemoConfig();
    if (cleanupTimer) return;
    void sweepExpiredDemoData();
    cleanupTimer = setInterval(() => { void sweepExpiredDemoData(); }, config.cleanupIntervalSeconds * 1000);
    cleanupTimer.unref();
}
