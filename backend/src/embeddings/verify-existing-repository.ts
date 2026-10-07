import { pool } from "../config/database.js";

async function run() {
    const repo = await pool.query<{ id: string }>(
        "SELECT id FROM repositories WHERE name = $1 ORDER BY indexed_at DESC NULLS LAST LIMIT 1",
        ["Ai-Finance-Controller"]
    );
    const repositoryId = repo.rows[0]?.id;
    if (!repositoryId) throw new Error("Ai-Finance-Controller is not indexed.");

    const [index, relationships, chunks, sanity, vectorDimensions, samples] = await Promise.all([
        pool.query("SELECT COUNT(DISTINCT f.id)::int AS file_count, COUNT(DISTINCT s.id)::int AS symbol_count FROM files f LEFT JOIN symbols s ON s.file_id=f.id WHERE f.repository_id=$1", [repositoryId]),
        pool.query(`WITH relationship_types(type) AS (
                        VALUES ('CALLS'), ('EXTENDS'), ('IMPLEMENTS'), ('IMPORTS')
                    )
                    SELECT t.type, COUNT(r.id)::int AS count
                    FROM relationship_types t
                    LEFT JOIN relationships r ON r.type=t.type AND r.repository_id=$1
                    GROUP BY t.type
                    UNION ALL
                    SELECT 'TOTAL', COUNT(*)::int FROM relationships WHERE repository_id=$1
                    ORDER BY type`, [repositoryId]),
        pool.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded, COUNT(*) FILTER (WHERE embedding IS NULL)::int AS missing FROM code_chunks WHERE repository_id=$1", [repositoryId]),
        pool.query(`SELECT
            (SELECT COUNT(*) FROM code_chunks c JOIN files f ON f.id=c.file_id WHERE c.repository_id=$1 AND f.repository_id<>c.repository_id)::int AS foreign_files,
            (SELECT COUNT(*) FROM code_chunks c JOIN symbols s ON s.id=c.symbol_id WHERE c.repository_id=$1 AND (s.repository_id<>c.repository_id OR s.file_id<>c.file_id))::int AS foreign_symbols,
            (SELECT COUNT(*) FROM code_chunks WHERE repository_id=$1 AND (start_line<1 OR end_line<start_line))::int AS invalid_lines,
            (SELECT COUNT(*) FROM code_chunks WHERE repository_id=$1 AND length(trim(content))=0)::int AS empty_content,
            (SELECT COUNT(*) FROM (SELECT file_id,symbol_id,start_line,end_line,content FROM code_chunks WHERE repository_id=$1 GROUP BY file_id,symbol_id,start_line,end_line,content HAVING COUNT(*)>1) d)::int AS duplicate_groups`, [repositoryId]),
        pool.query(`SELECT vector_dims(embedding) AS dimension, COUNT(*)::int AS count
                    FROM code_chunks WHERE repository_id=$1 AND embedding IS NOT NULL
                    GROUP BY vector_dims(embedding) ORDER BY dimension`, [repositoryId]),
        pool.query(`SELECT path, symbol, type, start_line, end_line, content
                    FROM (
                        SELECT f.path,
                               COALESCE(s.name, '[file-level]') AS symbol,
                               s.type, c.start_line, c.end_line, LEFT(c.content, 160) AS content,
                               CASE
                                   WHEN f.path LIKE '%.java' AND s.type='METHOD' THEN 'java-method'
                                   WHEN f.path LIKE '%.java' AND s.type='CLASS' THEN 'java-class'
                                   WHEN (f.path LIKE '%.ts' OR f.path LIKE '%.tsx') AND s.type='CLASS' THEN 'typescript-class'
                                   WHEN (f.path LIKE '%.ts' OR f.path LIKE '%.tsx') AND s.type='FUNCTION' THEN 'typescript-function'
                                   WHEN (f.path LIKE '%.js' OR f.path LIKE '%.jsx') AND s.type IN ('FUNCTION','METHOD') THEN 'javascript-function'
                               END AS sample_kind,
                               ROW_NUMBER() OVER (
                                   PARTITION BY CASE
                                       WHEN f.path LIKE '%.java' AND s.type='METHOD' THEN 'java-method'
                                       WHEN f.path LIKE '%.java' AND s.type='CLASS' THEN 'java-class'
                                       WHEN (f.path LIKE '%.ts' OR f.path LIKE '%.tsx') AND s.type='CLASS' THEN 'typescript-class'
                                       WHEN (f.path LIKE '%.ts' OR f.path LIKE '%.tsx') AND s.type='FUNCTION' THEN 'typescript-function'
                                       WHEN (f.path LIKE '%.js' OR f.path LIKE '%.jsx') AND s.type IN ('FUNCTION','METHOD') THEN 'javascript-function'
                                   END
                                   ORDER BY (c.end_line-c.start_line) DESC, c.start_line
                               ) AS sample_rank
                        FROM code_chunks c JOIN files f ON f.id=c.file_id
                        LEFT JOIN symbols s ON s.id=c.symbol_id
                        WHERE c.repository_id=$1
                    ) samples
                    WHERE sample_kind IS NOT NULL AND sample_rank=1
                    ORDER BY sample_kind`, [repositoryId])
    ]);
    console.log(JSON.stringify({ repositoryId, index: index.rows[0], relationships: relationships.rows,
        chunks: chunks.rows[0], sanity: sanity.rows[0], vectorDimensions: vectorDimensions.rows, samples: samples.rows }, null, 2));
}

try { await run(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally { await pool.end(); }
