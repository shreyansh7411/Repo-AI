import { pool } from "../config/database.js";
import { GeminiEmbeddingProvider } from "./gemini-embedding-provider.js";
import { embeddingText, validateEmbedding, type EmbeddingChunk } from "./types.js";

async function run() {
    const configured = Boolean(process.env.GEMINI_API_KEY?.trim());
    console.log(`GEMINI_API_KEY configured: ${configured ? "yes" : "no"}`);
    if (!configured) throw new Error("GEMINI_API_KEY is not configured.");

    const repo = await pool.query<{ id: string }>(
        "SELECT id FROM repositories WHERE name=$1 ORDER BY indexed_at DESC NULLS LAST LIMIT 1",
        ["Ai-Finance-Controller"]
    );
    if (!repo.rows[0]) throw new Error("Ai-Finance-Controller repository was not found.");
    const counts = await pool.query<{ total: string; missing: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE embedding IS NULL)::text AS missing
         FROM code_chunks WHERE repository_id=$1`, [repo.rows[0].id]);
    console.log(`Production chunk preflight: ${counts.rows[0].total} total, ${counts.rows[0].missing} missing embeddings.`);

    const sample = await pool.query<EmbeddingChunk>(
        `SELECT c.id, c.repository_id AS "repositoryId", c.file_id AS "fileId",
                f.path AS "filePath", c.symbol_id AS "symbolId", s.name AS "symbolName",
                s.type AS "symbolType", c.start_line AS "startLine", c.end_line AS "endLine",
                c.content
         FROM code_chunks c JOIN files f ON f.id=c.file_id
         LEFT JOIN symbols s ON s.id=c.symbol_id
         WHERE c.repository_id=$1 AND c.embedding IS NULL
         ORDER BY c.file_id,c.start_line LIMIT 1`, [repo.rows[0].id]);
    const chunk = sample.rows[0];
    if (!chunk) throw new Error("No unembedded representative chunk is available.");
    const [vector] = await new GeminiEmbeddingProvider().embedBatch([embeddingText(chunk)], "document");
    if (!vector) throw new Error("Gemini returned no embedding.");
    validateEmbedding(vector);
    console.log(`Gemini live smoke test passed: one representative chunk produced ${vector.length} finite values.`);
}

try { await run(); }
catch (error) {
    console.error(error instanceof Error ? error.message : "Gemini smoke test failed.");
    process.exitCode = 1;
}
finally { await pool.end(); }
