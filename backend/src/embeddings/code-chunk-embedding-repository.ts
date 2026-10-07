import type { Pool, PoolClient } from "pg";
import { pool } from "../config/database.js";
import { validateEmbedding, type EmbeddingChunk, type SearchChunk } from "./types.js";

type Db = Pool | PoolClient;

export class CodeChunkEmbeddingRepository {
    constructor(private readonly db: Db = pool) {}

    async repositoryExists(repositoryId: string): Promise<boolean> {
        const result = await this.db.query("SELECT 1 FROM repositories WHERE id = $1", [repositoryId]);
        return result.rowCount !== 0;
    }

    async getMissingEmbeddings(repositoryId: string, limit: number): Promise<EmbeddingChunk[]> {
        const result = await this.db.query<EmbeddingChunk>(
            `SELECT c.id, c.repository_id AS "repositoryId", c.file_id AS "fileId",
                    f.path AS "filePath", c.symbol_id AS "symbolId", s.name AS "symbolName",
                    s.type AS "symbolType", c.start_line AS "startLine", c.end_line AS "endLine",
                    c.content
             FROM code_chunks c
             JOIN files f ON f.id = c.file_id AND f.repository_id = c.repository_id
             LEFT JOIN symbols s ON s.id = c.symbol_id AND s.repository_id = c.repository_id
                                      AND s.file_id = c.file_id
             WHERE c.repository_id = $1 AND c.embedding IS NULL
             ORDER BY c.file_id, c.start_line, c.id
             LIMIT $2`, [repositoryId, limit]);
        return result.rows;
    }

    async saveEmbeddings(repositoryId: string, rows: Array<{ id: string; embedding: number[] }>): Promise<number> {
        for (const row of rows) validateEmbedding(row.embedding);
        if (rows.length === 0) return 0;
        const result = await this.db.query(
            `UPDATE code_chunks c
             SET embedding = values.embedding
             FROM UNNEST($1::uuid[], $2::vector[]) AS values(id, embedding)
             WHERE c.id = values.id AND c.repository_id = $3 AND c.embedding IS NULL`,
            [rows.map(row => row.id), rows.map(row => JSON.stringify(row.embedding)), repositoryId]);
        return result.rowCount ?? 0;
    }

    async countEmbeddings(repositoryId: string): Promise<{ total: number; embedded: number; missing: number }> {
        const result = await this.db.query<{ total: string; embedded: string }>(
            `SELECT COUNT(*)::text AS total,
                    COUNT(*) FILTER (WHERE embedding IS NOT NULL)::text AS embedded
             FROM code_chunks WHERE repository_id = $1`, [repositoryId]);
        const total = Number(result.rows[0]?.total ?? 0);
        const embedded = Number(result.rows[0]?.embedded ?? 0);
        return { total, embedded, missing: total - embedded };
    }

    async clearEmbeddings(repositoryId: string): Promise<number> {
        const result = await this.db.query(
            "UPDATE code_chunks SET embedding = NULL WHERE repository_id = $1 AND embedding IS NOT NULL", [repositoryId]);
        return result.rowCount ?? 0;
    }

    async search(repositoryId: string, vector: number[], limit: number): Promise<SearchChunk[]> {
        validateEmbedding(vector);
        const result = await this.db.query<SearchChunk>(
            `SELECT c.id, c.repository_id AS "repositoryId", c.file_id AS "fileId",
                    f.path AS "filePath", c.symbol_id AS "symbolId", s.name AS "symbolName",
                    s.type AS "symbolType", c.start_line AS "startLine", c.end_line AS "endLine",
                    c.content, 1 - (c.embedding <=> $2::vector) AS similarity
             FROM code_chunks c
             JOIN files f ON f.id = c.file_id AND f.repository_id = c.repository_id
             LEFT JOIN symbols s ON s.id = c.symbol_id AND s.repository_id = c.repository_id
                                      AND s.file_id = c.file_id
             WHERE c.repository_id = $1 AND c.embedding IS NOT NULL
             ORDER BY c.embedding <=> $2::vector, c.id
             LIMIT $3`, [repositoryId, JSON.stringify(vector), limit]);
        return result.rows;
    }
}
