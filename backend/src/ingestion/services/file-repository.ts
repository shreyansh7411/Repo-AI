import { pool } from "../../config/database.js";
import { DiscoveredFile } from "./file-discovery.js";

export interface SavedFile {
    id: string;
    path: string;
}

export async function saveFiles(
    repositoryId: string,
    files: DiscoveredFile[]
): Promise<void> {
    for (const file of files) {
        await pool.query(
            `
            INSERT INTO files (
                repository_id,
                path,
                language,
                size
            )
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (repository_id, path)
            DO UPDATE SET
                language = EXCLUDED.language,
                size = EXCLUDED.size
            `,
            [
                repositoryId,
                file.relativePath,
                file.language,
                file.size
            ]
        );
    }
}

export async function getSavedFiles(
    repositoryId: string
): Promise<SavedFile[]> {
    const result = await pool.query<SavedFile>(
        `
        SELECT id, path
        FROM files
        WHERE repository_id = $1
        `,
        [repositoryId]
    );

    return result.rows;
}
