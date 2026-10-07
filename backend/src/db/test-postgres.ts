import { pool } from "../.../../config/database.js";

async function testPostgres() {
    try {
        const result = await pool.query(`
            SELECT
                r.name,
                COUNT(f.id) AS files
            FROM repositories r
            LEFT JOIN files f
                ON f.repository_id = r.id
            GROUP BY r.id, r.name
        `);

        console.table(result.rows);
    } catch (error) {
        console.error("PostgreSQL test failed:", error);
    } finally {
        await pool.end();
    }
}

testPostgres();
