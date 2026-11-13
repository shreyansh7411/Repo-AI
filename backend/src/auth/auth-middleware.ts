import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE, getSessionUserId } from "./session.js";

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
    const userId = token ? await getSessionUserId(token) : null;
    if (!userId) {
        res.status(401).json({ error: "Authentication required." });
        return;
    }
    req.auth = { userId };
    next();
}
