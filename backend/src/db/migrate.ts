import dotenv from "dotenv";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { pool } from "../config/database.js";

dotenv.config();

async function runMigration() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const tables = await pool.query<{ t: string | null }>(
            "SELECT to_regclass('public.repositories') AS t"
        );

        if (tables.rows[0]?.t) {
            await pool.query(
                `
                INSERT INTO schema_migrations (filename)
                VALUES ('001_initial_schema.sql')
                ON CONFLICT (filename) DO NOTHING
                `
            );
        }

        const migrationsDir = "src/db/migrations";
        const files = readdirSync(migrationsDir)
            .filter(file => file.endsWith(".sql"))
            .sort();

        for (const filename of files) {
            const applied = await pool.query(
                "SELECT 1 FROM schema_migrations WHERE filename = $1",
                [filename]
            );

            if ((applied.rowCount ?? 0) > 0) {
                console.log(`Skipping ${filename} (already applied)`);
                continue;
            }

            const sql = readFileSync(
                path.join(migrationsDir, filename),
                "utf-8"
            );
            await pool.query(sql);
            await pool.query(
                "INSERT INTO schema_migrations (filename) VALUES ($1)",
                [filename]
            );
            console.log(`Applied ${filename}`);
        }

        console.log("Database schema created successfully");
    } catch (error) {
        console.error("Migration failed:", error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

runMigration();
