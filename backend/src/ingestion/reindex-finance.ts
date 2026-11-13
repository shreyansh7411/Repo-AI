import { pool } from "../config/database.js";
import { indexRepository } from "./services/repository-service.js";

async function run() {
    const existing = await pool.query<{ name: string; url: string | null; ownerUserId: string | null }>(
        `
        SELECT name, url, owner_user_id AS "ownerUserId"
        FROM repositories
        WHERE name = $1
          AND owner_user_id IS NOT NULL
        ORDER BY indexed_at DESC NULLS LAST, created_at DESC
        LIMIT 1
        `,
        ["Ai-Finance-Controller"]
    );

    const name = existing.rows[0]?.name ?? "Ai-Finance-Controller";
    const url =
        existing.rows[0]?.url ??
        "https://example.invalid/Ai-Finance-Controller.git";
    const ownerUserId = existing.rows[0]?.ownerUserId;
    if (!ownerUserId) throw new Error("The indexed repository has no owner; complete legacy ownership bootstrap first.");

    console.log("Indexing", { name });
    const first = await indexRepository(name, url, ownerUserId);
    console.log("First index:", first);
    const second = await indexRepository(name, url, ownerUserId);
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
