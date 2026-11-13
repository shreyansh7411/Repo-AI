import type { NextFunction, Request, Response } from "express";
import { pool } from "../config/database.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function repositoryIdFromRoute(value: string | string[] | undefined): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

export async function requireRepositoryOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
    const repositoryId = repositoryIdFromRoute(req.params.repositoryId);
    if (!repositoryId || !uuidPattern.test(repositoryId)) {
        res.status(400).json({ error: { code: "INVALID_REPOSITORY_ID", message: "A valid repositoryId is required." } });
        return;
    }
    if (!req.auth?.userId) {
        res.status(401).json({ error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication required." } });
        return;
    }

    try {
        const result = await pool.query(
            "SELECT 1 FROM repositories WHERE id = $1 AND owner_user_id = $2",
            [repositoryId, req.auth.userId]
        );
        if ((result.rowCount ?? 0) === 0) {
            res.status(404).json({ error: { code: "REPOSITORY_NOT_FOUND", message: "Repository was not found." } });
            return;
        }
        next();
    } catch {
        res.status(500).json({ error: { code: "REPOSITORY_ACCESS_FAILED", message: "Repository access could not be verified." } });
    }
}
