import type { PoolClient } from "pg";
import { pool } from "../../config/database.js";
import type { ExtractedSymbol, SymbolType } from "../../parser/symbol-types.js";
import type { ResolvableSymbol } from "../../parser/symbol-resolver.js";

export interface SymbolRecord extends ExtractedSymbol {
    fileId: string;
}

export interface SavedSymbol extends ResolvableSymbol {
    type: SymbolType;
}

export async function saveSymbols(
    repositoryId: string,
    symbols: SymbolRecord[],
    client?: PoolClient
): Promise<number> {
    const ownedClient = !client;
    const db = client ?? (await pool.connect());

    try {
        if (ownedClient) {
            await db.query("BEGIN");
        }

        await db.query(
            "DELETE FROM symbols WHERE repository_id = $1",
            [repositoryId]
        );

        for (const symbol of symbols) {
            await db.query(
                `
                INSERT INTO symbols (
                    repository_id,
                    file_id,
                    name,
                    type,
                    start_line,
                    end_line,
                    signature
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                `,
                [
                    repositoryId,
                    symbol.fileId,
                    symbol.name,
                    symbol.type,
                    symbol.startLine,
                    symbol.endLine,
                    symbol.signature
                ]
            );
        }

        if (ownedClient) {
            await db.query("COMMIT");
        }

        return symbols.length;
    } catch (error) {
        if (ownedClient) {
            await db.query("ROLLBACK");
        }
        throw error;
    } finally {
        if (ownedClient) {
            db.release();
        }
    }
}

export async function getSymbols(
    repositoryId: string,
    client?: PoolClient
): Promise<SavedSymbol[]> {
    const db = client ?? pool;
    const result = await db.query<{
        id: string;
        repository_id: string;
        file_id: string;
        name: string;
        type: SymbolType;
        start_line: number;
        end_line: number;
    }>(
        `
        SELECT
            id,
            repository_id,
            file_id,
            name,
            type,
            start_line,
            end_line
        FROM symbols
        WHERE repository_id = $1
        `,
        [repositoryId]
    );

    return result.rows.map(row => ({
        id: row.id,
        repositoryId: row.repository_id,
        fileId: row.file_id,
        name: row.name,
        type: row.type,
        startLine: row.start_line,
        endLine: row.end_line
    }));
}
