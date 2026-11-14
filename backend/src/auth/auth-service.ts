import argon2 from "argon2";
import { pool } from "../config/database.js";
import type { AuthUser } from "./auth-types.js";

interface UserRow {
    id: string;
    name: string;
    email: string;
    createdAt: Date;
}

function toAuthUser(row: UserRow): AuthUser {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        createdAt: row.createdAt.toISOString()
    };
}

export async function registerUser(name: string, normalizedEmail: string, password: string): Promise<AuthUser | null> {
    const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1
    });
    const result = await pool.query<UserRow>(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, name, email, created_at AS "createdAt"`,
        [name, normalizedEmail, passwordHash]
    );
    return result.rows[0] ? toAuthUser(result.rows[0]) : null;
}

export async function authenticateUser(normalizedEmail: string, password: string): Promise<AuthUser | null> {
    const result = await pool.query<UserRow & { passwordHash: string }>(
        `SELECT id, name, email, created_at AS "createdAt", password_hash AS "passwordHash"
         FROM users WHERE email = $1`,
        [normalizedEmail]
    );
    const row = result.rows[0];
    if (!row || !(await argon2.verify(row.passwordHash, password))) return null;
    return toAuthUser(row);
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
    const result = await pool.query<UserRow>(
        `SELECT id, name, email, created_at AS "createdAt"
         FROM users WHERE id = $1`,
        [userId]
    );
    return result.rows[0] ? toAuthUser(result.rows[0]) : null;
}

export async function updateUserName(userId: string, name: string): Promise<AuthUser | null> {
    const result = await pool.query<UserRow>(
        `UPDATE users SET name = $2 WHERE id = $1
         RETURNING id, name, email, created_at AS "createdAt"`,
        [userId, name]
    );
    return result.rows[0] ? toAuthUser(result.rows[0]) : null;
}

export async function changeUserPassword(
    userId: string,
    currentPassword: string,
    newPassword: string
): Promise<{ status: "updated"; user: AuthUser; sessionVersion: number } | { status: "invalid-current-password" }> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const selected = await client.query<UserRow & { passwordHash: string; sessionVersion: number }>(
            `SELECT id, name, email, created_at AS "createdAt", password_hash AS "passwordHash",
                    session_version AS "sessionVersion"
             FROM users WHERE id = $1 FOR UPDATE`,
            [userId]
        );
        const row = selected.rows[0];
        if (!row || !(await argon2.verify(row.passwordHash, currentPassword))) {
            await client.query("ROLLBACK");
            return { status: "invalid-current-password" };
        }

        const passwordHash = await argon2.hash(newPassword, {
            type: argon2.argon2id,
            memoryCost: 19_456,
            timeCost: 2,
            parallelism: 1
        });
        const updated = await client.query<UserRow & { sessionVersion: number }>(
            `UPDATE users
             SET password_hash = $2, session_version = session_version + 1
             WHERE id = $1
             RETURNING id, name, email, created_at AS "createdAt", session_version AS "sessionVersion"`,
            [userId, passwordHash]
        );
        await client.query("COMMIT");
        const updatedRow = updated.rows[0];
        return { status: "updated", user: toAuthUser(updatedRow), sessionVersion: updatedRow.sessionVersion };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
