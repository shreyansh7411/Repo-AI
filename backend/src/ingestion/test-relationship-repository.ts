import assert from "node:assert/strict";
import { pool } from "../config/database.js";
import { replaceRelationships } from "./services/relationship-repository.js";

async function run() {
    const uniqueIndex = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'relationships'
          AND indexname = 'relationships_unique_edge'
    `);

    if (uniqueIndex.rowCount === 0) {
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS relationships_unique_edge
            ON relationships (
                repository_id,
                source_symbol_id,
                target_symbol_id,
                type
            )
        `);
    }

    const repoA = await pool.query<{ id: string }>(
        `
        INSERT INTO repositories (name, url)
        VALUES ('rel-persist-a', 'https://example.invalid/rel-persist-a.git')
        RETURNING id
        `
    );
    const repoB = await pool.query<{ id: string }>(
        `
        INSERT INTO repositories (name, url)
        VALUES ('rel-persist-b', 'https://example.invalid/rel-persist-b.git')
        RETURNING id
        `
    );

    const repositoryAId = repoA.rows[0].id;
    const repositoryBId = repoB.rows[0].id;

    try {
        const fileA = await pool.query<{ id: string }>(
            `
            INSERT INTO files (repository_id, path, language, size)
            VALUES ($1, 'A.java', 'java', 10)
            RETURNING id
            `,
            [repositoryAId]
        );
        const fileB = await pool.query<{ id: string }>(
            `
            INSERT INTO files (repository_id, path, language, size)
            VALUES ($1, 'B.java', 'java', 10)
            RETURNING id
            `,
            [repositoryBId]
        );

        const sourceA = await pool.query<{ id: string }>(
            `
            INSERT INTO symbols (
                repository_id, file_id, name, type, start_line, end_line
            )
            VALUES ($1, $2, 'processPayment', 'METHOD', 1, 10)
            RETURNING id
            `,
            [repositoryAId, fileA.rows[0].id]
        );
        const targetA = await pool.query<{ id: string }>(
            `
            INSERT INTO symbols (
                repository_id, file_id, name, type, start_line, end_line
            )
            VALUES ($1, $2, 'savePayment', 'METHOD', 12, 14)
            RETURNING id
            `,
            [repositoryAId, fileA.rows[0].id]
        );
        const sourceB = await pool.query<{ id: string }>(
            `
            INSERT INTO symbols (
                repository_id, file_id, name, type, start_line, end_line
            )
            VALUES ($1, $2, 'processPayment', 'METHOD', 1, 10)
            RETURNING id
            `,
            [repositoryBId, fileB.rows[0].id]
        );
        const targetB = await pool.query<{ id: string }>(
            `
            INSERT INTO symbols (
                repository_id, file_id, name, type, start_line, end_line
            )
            VALUES ($1, $2, 'savePayment', 'METHOD', 12, 14)
            RETURNING id
            `,
            [repositoryBId, fileB.rows[0].id]
        );

        const duplicates = [
            {
                sourceSymbolId: sourceA.rows[0].id,
                targetSymbolId: targetA.rows[0].id,
                type: "CALLS" as const
            },
            {
                sourceSymbolId: sourceA.rows[0].id,
                targetSymbolId: targetA.rows[0].id,
                type: "CALLS" as const
            }
        ];

        const firstCount = await replaceRelationships(
            repositoryAId,
            duplicates
        );
        const secondCount = await replaceRelationships(
            repositoryAId,
            duplicates
        );

        assert.equal(firstCount, 1);
        assert.equal(secondCount, 1);

        const storedA = await pool.query<{ n: string }>(
            "SELECT COUNT(*)::text AS n FROM relationships WHERE repository_id = $1",
            [repositoryAId]
        );
        assert.equal(storedA.rows[0].n, "1");

        await replaceRelationships(repositoryBId, [
            {
                sourceSymbolId: sourceB.rows[0].id,
                targetSymbolId: targetB.rows[0].id,
                type: "CALLS"
            }
        ]);

        const cross = await pool.query<{ n: string }>(
            `
            SELECT COUNT(*)::text AS n
            FROM relationships rel
            JOIN symbols source ON source.id = rel.source_symbol_id
            JOIN symbols target ON target.id = rel.target_symbol_id
            WHERE source.repository_id <> target.repository_id
               OR rel.repository_id <> source.repository_id
               OR rel.repository_id <> target.repository_id
            `
        );
        assert.equal(cross.rows[0].n, "0");

        console.log("Relationship persistence tests passed.");
    } finally {
        await pool.query("DELETE FROM repositories WHERE id = ANY($1)", [
            [repositoryAId, repositoryBId]
        ]);
        await pool.end();
    }
}

try {
    await run();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
