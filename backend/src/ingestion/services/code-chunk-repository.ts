import type { PoolClient } from "pg";
import { pool } from "../../config/database.js";
import type { CodeChunkRecord } from "../../chunking/code-chunk-builder.js";

export interface SavedCodeChunk extends CodeChunkRecord {
    id: string;
    repositoryId: string;
}

export async function replaceCodeChunks(
    repositoryId: string,
    chunks: CodeChunkRecord[],
    client: PoolClient
): Promise<number> {
    const unique = new Map<string, CodeChunkRecord>();
    for (const chunk of chunks) {
        if (!chunk.content.trim() || chunk.startLine < 1 || chunk.endLine < chunk.startLine) {
            throw new Error("Invalid code chunk content or line range.");
        }
        const key = `${chunk.fileId}\0${chunk.startLine}\0${chunk.endLine}\0${chunk.content}`;
        if (!unique.has(key)) unique.set(key, chunk);
    }
    const records = [...unique.values()];
    await client.query("DELETE FROM code_chunks WHERE repository_id = $1", [repositoryId]);
    if (!records.length) return 0;

    const invalid = await client.query<{ count: string }>(
        `
        SELECT COUNT(*)::text AS count
        FROM UNNEST($1::uuid[], $2::uuid[]) AS chunk(file_id, symbol_id)
        LEFT JOIN files f ON f.id = chunk.file_id
        LEFT JOIN symbols s ON s.id = chunk.symbol_id
        WHERE f.id IS NULL OR f.repository_id <> $3
           OR (chunk.symbol_id IS NOT NULL AND (
                s.id IS NULL OR s.repository_id <> $3 OR s.file_id <> chunk.file_id
           ))
        `,
        [records.map(chunk => chunk.fileId), records.map(chunk => chunk.symbolId), repositoryId]
    );
    if (Number(invalid.rows[0]?.count ?? 0) > 0) {
        throw new Error("Code chunks must reference a file and symbol from the same repository and file.");
    }

    await client.query(
        `
        INSERT INTO code_chunks (
            repository_id,
            file_id,
            symbol_id,
            start_line,
            end_line,
            content
        )
        SELECT $1, file_id, symbol_id, start_line, end_line, content
        FROM UNNEST(
            $2::uuid[],
            $3::uuid[],
            $4::integer[],
            $5::integer[],
            $6::text[]
        ) AS chunk(file_id, symbol_id, start_line, end_line, content)
        `,
        [
            repositoryId,
            records.map(chunk => chunk.fileId),
            records.map(chunk => chunk.symbolId),
            records.map(chunk => chunk.startLine),
            records.map(chunk => chunk.endLine),
            records.map(chunk => chunk.content)
        ]
    );
    return records.length;
}

export async function deleteChunksForRepository(
    repositoryId: string,
    client?: PoolClient
): Promise<void> {
    const db = client ?? pool;
    await db.query("DELETE FROM code_chunks WHERE repository_id = $1", [repositoryId]);
}

export async function countChunks(repositoryId: string, client?: PoolClient): Promise<number> {
    const db = client ?? pool;
    const result = await db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM code_chunks WHERE repository_id = $1",
        [repositoryId]
    );
    return Number(result.rows[0]?.count ?? 0);
}

export async function getChunksForRepository(repositoryId: string, client?: PoolClient): Promise<SavedCodeChunk[]> {
    const db = client ?? pool;
    const result = await db.query<SavedCodeChunk>(
        `SELECT id, repository_id AS "repositoryId", file_id AS "fileId",
                symbol_id AS "symbolId", start_line AS "startLine",
                end_line AS "endLine", content
         FROM code_chunks WHERE repository_id = $1 ORDER BY file_id, start_line, end_line`,
        [repositoryId]
    );
    return result.rows;
}
