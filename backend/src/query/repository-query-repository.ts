import type { Pool, PoolClient } from "pg";
import { pool } from "../config/database.js";
import type { RepositoryFile, RepositorySymbol } from "./types.js";

type Db = Pool | PoolClient;

export class RepositoryQueryRepository {
    constructor(private readonly db: Db = pool) {}

    async repositoryExists(repositoryId: string): Promise<boolean> {
        const result = await this.db.query("SELECT 1 FROM repositories WHERE id=$1", [repositoryId]);
        return result.rowCount !== 0;
    }

    async getSymbol(repositoryId: string, symbolId: string): Promise<RepositorySymbol | null> {
        const result = await this.db.query<{
            id: string; name: string; type: string; signature: string | null;
            fileId: string; filePath: string; language: string | null; startLine: number; endLine: number;
            parentId: string | null; parentName: string | null; parentType: string | null;
        }>(
            `SELECT s.id, s.name, s.type, s.signature, f.id AS "fileId", f.path AS "filePath", f.language,
                    s.start_line AS "startLine", s.end_line AS "endLine",
                    p.id AS "parentId", p.name AS "parentName", p.type AS "parentType"
             FROM symbols s
             JOIN files f ON f.id=s.file_id AND f.repository_id=s.repository_id
             LEFT JOIN symbols p ON p.id=s.parent_symbol_id AND p.repository_id=s.repository_id
             WHERE s.repository_id=$1 AND s.id=$2`, [repositoryId, symbolId]);
        const row = result.rows[0];
        return row ? {
            id: row.id, name: row.name, type: row.type, signature: row.signature,
            file: { id: row.fileId, path: row.filePath, language: row.language },
            startLine: row.startLine, endLine: row.endLine,
            parent: row.parentId ? { id: row.parentId, name: row.parentName ?? "", type: row.parentType ?? "" } : null
        } : null;
    }

    async getFile(repositoryId: string, path: string): Promise<RepositoryFile | null> {
        const result = await this.db.query<{
            id: string; path: string; language: string | null; size: string | null; hash: string | null;
            symbols: RepositoryFile["symbols"]; chunkCount: string;
        }>(
            `SELECT f.id, f.path, f.language, f.size::text AS size, f.hash,
                    COALESCE((SELECT json_agg(json_build_object(
                        'id', s.id, 'name', s.name, 'type', s.type, 'signature', s.signature,
                        'startLine', s.start_line, 'endLine', s.end_line, 'parentSymbolId', s.parent_symbol_id
                    ) ORDER BY s.start_line, s.name, s.id) FROM symbols s
                      WHERE s.repository_id=f.repository_id AND s.file_id=f.id), '[]'::json) AS symbols,
                    (SELECT COUNT(*)::text FROM code_chunks c
                     WHERE c.repository_id=f.repository_id AND c.file_id=f.id) AS "chunkCount"
             FROM files f WHERE f.repository_id=$1 AND replace(f.path, chr(92), '/')=$2`, [repositoryId, path]);
        const row = result.rows[0];
        if (!row) return null;
        const size = row.size === null ? null : Number(row.size);
        return { id: row.id, path: row.path, language: row.language,
            size: size !== null && Number.isSafeInteger(size) ? size : null, hash: row.hash,
            symbols: row.symbols ?? [], chunkCount: Number(row.chunkCount) };
    }
}
