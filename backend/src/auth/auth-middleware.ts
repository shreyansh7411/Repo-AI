import type { NextFunction, Request, Response } from "express";
import { pool } from "../config/database.js";
import { SESSION_COOKIE, getSessionClaims } from "./session.js";

function sessionTokenFromRequest(req: Request): string | null {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
        return part.slice(separator + 1).trim() || null;
    }
    return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = sessionTokenFromRequest(req);
    const claims = token ? await getSessionClaims(token) : null;
    if (!claims) {
        res.status(401).json({ error: "Authentication required." });
        return;
    }
    try {
        const result = await pool.query<{ sessionVersion: number }>(
            "SELECT session_version AS \"sessionVersion\" FROM users WHERE id = $1",
            [claims.userId]
        );
        if (!result.rows[0] || result.rows[0].sessionVersion !== claims.sessionVersion) {
            res.status(401).json({ error: "Authentication required." });
            return;
        }
        req.auth = claims;
        next();
    } catch {
        res.status(500).json({ error: "Authentication could not be verified." });
    }
}
