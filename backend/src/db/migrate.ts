import dotenv from "dotenv";
import { readdirSync, readFileSync } from "fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../config/database.js";

dotenv.config();

async function runMigration() {
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock($1)", [741205190]);
        await client.query("CREATE EXTENSION IF NOT EXISTS vector");
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const tables = await client.query<{ t: string | null }>(
            "SELECT to_regclass('public.repositories') AS t"
        );

        if (tables.rows[0]?.t) {
            await client.query(
                `
                INSERT INTO schema_migrations (filename)
                VALUES ('001_initial_schema.sql')
                ON CONFLICT (filename) DO NOTHING
                `
            );
        }

        const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url));
        const files = readdirSync(migrationsDir)
            .filter(file => file.endsWith(".sql"))
            .sort();

        for (const filename of files) {
            const applied = await client.query(
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
            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query(
                    "INSERT INTO schema_migrations (filename) VALUES ($1)",
                    [filename]
                );
                await client.query("COMMIT");
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            }
            console.log(`Applied ${filename}`);
        }

        console.log("Database schema created successfully");
    } catch (error) {
        console.error("Migration failed. Check database connectivity and migration SQL.");
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
