import { pool } from "../config/database.js";

async function run() {
    const byType = await pool.query(`
        SELECT type, COUNT(*)::int AS count
        FROM relationships
        GROUP BY type
        ORDER BY type
    `);

    const byRepo = await pool.query(`
        SELECT
            r.name,
            COUNT(DISTINCT rel.id)::int AS relationships
        FROM repositories r
        LEFT JOIN relationships rel
            ON rel.repository_id = r.id
        GROUP BY r.id, r.name
        ORDER BY r.name
    `);

    const cross = await pool.query(`
        SELECT COUNT(*)::int AS n
        FROM relationships rel
        JOIN symbols source ON source.id = rel.source_symbol_id
        JOIN symbols target ON target.id = rel.target_symbol_id
        WHERE source.repository_id <> target.repository_id
           OR rel.repository_id <> source.repository_id
           OR rel.repository_id <> target.repository_id
    `);

    const duplicates = await pool.query(`
        SELECT COUNT(*)::int AS n
        FROM (
            SELECT repository_id, source_symbol_id, target_symbol_id, type
            FROM relationships
            GROUP BY repository_id, source_symbol_id, target_symbol_id, type
            HAVING COUNT(*) > 1
        ) d
    `);

    console.log("Relationships by type:");
    console.table(byType.rows);
    console.log("Relationships by repository:");
    console.table(byRepo.rows);
    console.log("Cross-repository relationships:", cross.rows[0]);
    console.log("Duplicate relationship groups:", duplicates.rows[0]);
}

try {
    await run();
} finally {
    await pool.end();
}
