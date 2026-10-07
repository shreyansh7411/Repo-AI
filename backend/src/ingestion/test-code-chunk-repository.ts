import assert from "node:assert/strict";
import { pool } from "../config/database.js";
import { replaceCodeChunks } from "./services/code-chunk-repository.js";

async function run() {
    const repos = await pool.query<{ id: string }>(
        `INSERT INTO repositories (name, url) VALUES ('chunk-test-a', 'chunk-test-a') RETURNING id`
    );
    const repoA = repos.rows[0].id;
    const reposB = await pool.query<{ id: string }>(
        `INSERT INTO repositories (name, url) VALUES ('chunk-test-b', 'chunk-test-b') RETURNING id`
    );
    const repoB = reposB.rows[0].id;
    try {
        const fileA = await pool.query<{ id: string }>(`INSERT INTO files (repository_id, path, language) VALUES ($1, 'A.ts', 'typescript') RETURNING id`, [repoA]);
        const fileB = await pool.query<{ id: string }>(`INSERT INTO files (repository_id, path, language) VALUES ($1, 'B.ts', 'typescript') RETURNING id`, [repoB]);
        const symbolA = await pool.query<{ id: string }>(`INSERT INTO symbols (repository_id, file_id, name, type, start_line, end_line) VALUES ($1, $2, 'run', 'FUNCTION', 1, 2) RETURNING id`, [repoA, fileA.rows[0].id]);
        const symbolB = await pool.query<{ id: string }>(`INSERT INTO symbols (repository_id, file_id, name, type, start_line, end_line) VALUES ($1, $2, 'other', 'FUNCTION', 1, 2) RETURNING id`, [repoB, fileB.rows[0].id]);
        const valid = {
            fileId: fileA.rows[0].id,
            symbolId: symbolA.rows[0].id,
            startLine: 1,
            endLine: 2,
            content: "function run() {}"
        };
        const saveClient = await pool.connect();
        const count = await replaceCodeChunks(repoA, [valid, valid], saveClient);
        saveClient.release();
        assert.equal(count, 1, "duplicate chunks must be collapsed before batch insert");

        const before = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM code_chunks WHERE repository_id = $1", [repoA]);
        assert.equal(before.rows[0].n, "1");
        const otherRepo = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM code_chunks WHERE repository_id = $1", [repoB]);
        assert.equal(otherRepo.rows[0].n, "0", "repository-scoped replacement must not affect other repositories");

        const client = await pool.connect();
        await client.query("BEGIN");
        await assert.rejects(
            replaceCodeChunks(repoA, [{ ...valid, fileId: fileB.rows[0].id }], client),
            /same repository and file/
        );
        await client.query("ROLLBACK");
        client.release();

        const after = await pool.query<{ content: string; symbol_id: string | null }>("SELECT content, symbol_id FROM code_chunks WHERE repository_id = $1", [repoA]);
        assert.equal(after.rows.length, 1, "rollback must preserve the previous valid chunk set");
        assert.equal(after.rows[0].content, valid.content);
        assert.equal(after.rows[0].symbol_id, symbolA.rows[0].id);

        const invalidSymbolClient = await pool.connect();
        await invalidSymbolClient.query("BEGIN");
        await assert.rejects(
            replaceCodeChunks(repoA, [{ ...valid, symbolId: symbolB.rows[0].id }], invalidSymbolClient),
            /same repository and file/
        );
        await invalidSymbolClient.query("ROLLBACK");
        invalidSymbolClient.release();

        const constraints = await pool.query(`
            SELECT COUNT(*)::int AS invalid
            FROM code_chunks c
            JOIN files f ON f.id = c.file_id
            JOIN symbols s ON s.id = c.symbol_id
            WHERE c.repository_id <> f.repository_id OR c.repository_id <> s.repository_id OR c.file_id <> s.file_id
        `);
        assert.equal(constraints.rows[0].invalid, 0);
        console.log("Code chunk repository tests passed.");
    } finally {
        await pool.query("DELETE FROM repositories WHERE id = ANY($1)", [[repoA, repoB]]);
        await pool.end();
    }
}

try {
    await run();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
