import { pool } from "../config/database.js";
import { indexRepository } from "./services/repository-service.js";

async function run() {
    const existing = await pool.query<{ name: string; url: string | null }>(
        `
        SELECT name, url
        FROM repositories
        WHERE name = $1
        ORDER BY indexed_at DESC NULLS LAST, created_at DESC
        LIMIT 1
        `,
        ["Ai-Finance-Controller"]
    );

    const name = existing.rows[0]?.name ?? "Ai-Finance-Controller";
    const url =
        existing.rows[0]?.url ??
        "https://example.invalid/Ai-Finance-Controller.git";

    console.log("Indexing", { name, url });
    const first = await indexRepository(name, url);
    console.log("First index:", first);
    const second = await indexRepository(name, url);
    console.log("Re-index:", second);
}

try {
    await run();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
