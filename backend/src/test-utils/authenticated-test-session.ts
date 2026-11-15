import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import { createSessionToken, SESSION_COOKIE, sessionCookie } from "../auth/session.js";

export interface AuthenticatedTestSession {
    userId: string;
    cookieHeader: string;
    cleanup(): Promise<void>;
}

export async function createAuthenticatedTestSession(): Promise<AuthenticatedTestSession> {
    const previousSecret = process.env.AUTH_JWT_SECRET;
    process.env.AUTH_JWT_SECRET = randomBytes(32).toString("base64url");
    let userId: string | undefined;
    try {
        const result = await pool.query<{ id: string }>(
            `INSERT INTO users (name, email, password_hash)
             VALUES ($1, $2, $3) RETURNING id`,
            ["Repo-AI Integration Test", `repo-ai-test-${randomUUID()}@example.test`, "test-only-unused-password-hash"]
        );
        userId = result.rows[0]?.id;
        if (!userId) throw new Error("Test user creation did not return an id.");

        const token = await createSessionToken(userId, 0);
        const cookieHeader = sessionCookie(token).split(";", 1)[0];
        if (!cookieHeader.startsWith(`${SESSION_COOKIE}=`)) throw new Error("Test session cookie was not created.");

        let cleaned = false;
        return {
            userId,
            cookieHeader,
            async cleanup() {
                if (cleaned) return;
                try {
                    const client = await pool.connect();
                    try {
                        await client.query("BEGIN");
                        // Each helper-created user is unique; all repositories owned by it are test fixtures.
                        await client.query("DELETE FROM repositories WHERE owner_user_id=$1", [userId]);
                        await client.query("DELETE FROM users WHERE id=$1", [userId]);
                        await client.query("COMMIT");
                        cleaned = true;
                    } catch (error) {
                        await client.query("ROLLBACK");
                        throw error;
                    } finally {
                        client.release();
                    }
                } finally {
                    if (previousSecret === undefined) delete process.env.AUTH_JWT_SECRET;
                    else process.env.AUTH_JWT_SECRET = previousSecret;
                }
            }
        };
    } catch (error) {
        try { if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]); }
        finally {
            if (previousSecret === undefined) delete process.env.AUTH_JWT_SECRET;
            else process.env.AUTH_JWT_SECRET = previousSecret;
        }
        throw error;
    }
}
