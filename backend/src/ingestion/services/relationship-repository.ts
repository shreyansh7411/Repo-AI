import type { PoolClient } from "pg";
import { pool } from "../../config/database.js";

export interface RelationshipRecord {
    sourceSymbolId: string;
    targetSymbolId: string;
    type: "CALLS" | "EXTENDS" | "IMPLEMENTS" | "IMPORTS";
}

function relationshipKey(relationship: RelationshipRecord): string {
    return `${relationship.sourceSymbolId}\0${relationship.targetSymbolId}\0${relationship.type}`;
}

export function dedupeRelationships(
    relationships: RelationshipRecord[]
): RelationshipRecord[] {
    const unique = new Map<string, RelationshipRecord>();

    for (const relationship of relationships) {
        unique.set(relationshipKey(relationship), relationship);
    }

    return [...unique.values()];
}

export async function replaceRelationships(
    repositoryId: string,
    relationships: RelationshipRecord[],
    client?: PoolClient
): Promise<number> {
    const unique = dedupeRelationships(relationships);
    const ownedClient = !client;
    const db = client ?? (await pool.connect());

    try {
        if (ownedClient) {
            await db.query("BEGIN");
        }

        await db.query(
            "DELETE FROM relationships WHERE repository_id = $1",
            [repositoryId]
        );

        if (unique.length > 0) {
            await db.query(
                `
                INSERT INTO relationships (
                    repository_id,
                    source_symbol_id,
                    target_symbol_id,
                    type
                )
                SELECT
                    $1,
                    source_symbol_id,
                    target_symbol_id,
                    type
                FROM UNNEST(
                    $2::uuid[],
                    $3::uuid[],
                    $4::varchar[]
                ) AS t(source_symbol_id, target_symbol_id, type)
                ON CONFLICT (
                    repository_id,
                    source_symbol_id,
                    target_symbol_id,
                    type
                )
                DO NOTHING
                `,
                [
                    repositoryId,
                    unique.map(relationship => relationship.sourceSymbolId),
                    unique.map(relationship => relationship.targetSymbolId),
                    unique.map(relationship => relationship.type)
                ]
            );
        }

        if (ownedClient) {
            await db.query("COMMIT");
        }

        return unique.length;
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
