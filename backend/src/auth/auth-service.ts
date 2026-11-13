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
