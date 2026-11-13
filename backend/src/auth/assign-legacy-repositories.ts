import { pool } from "../config/database.js";

const ownerUserId = process.env.LEGACY_REPOSITORY_OWNER_ID;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function assignLegacyRepositories(): Promise<void> {
    if (!ownerUserId || !uuidPattern.test(ownerUserId)) {
        throw new Error("Set LEGACY_REPOSITORY_OWNER_ID to the trusted user's UUID before running this command.");
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [741205192]);
        const owner = await client.query("SELECT 1 FROM users WHERE id = $1", [ownerUserId]);
        if ((owner.rowCount ?? 0) === 0) {
            throw new Error("The configured legacy repository owner does not exist.");
        }
        const updated = await client.query(
            "UPDATE repositories SET owner_user_id = $1 WHERE owner_user_id IS NULL",
            [ownerUserId]
        );
        await client.query("COMMIT");
        console.info(`Assigned ${updated.rowCount ?? 0} legacy repositories to the configured owner.`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

try {
    await assignLegacyRepositories();
} catch {
    console.error("Legacy repository ownership bootstrap failed; no repository records were changed.");
    process.exitCode = 1;
} finally {
    await pool.end();
}
