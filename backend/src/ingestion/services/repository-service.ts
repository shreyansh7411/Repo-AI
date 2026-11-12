import path from "node:path";
import { pool } from "../../config/database.js";
import { cloneRepository } from "./repository-cloner.js";
import { discoverFiles } from "./file-discovery.js";
import { saveFiles, getSavedFiles } from "./file-repository.js";
import { ParserService } from "../../parser/parser-service.js";
import { extractSymbols } from "../../parser/symbol-extractor.js";
import { getSymbols, saveSymbols, type SymbolRecord } from "./symbol-repository.js";
import {
    buildCallRelationships,
    type ParsedRepositoryFile
} from "./relationship-builder.js";
import { replaceRelationships } from "./relationship-repository.js";
import { buildCodeChunks } from "../../chunking/code-chunk-builder.js";
import { replaceCodeChunks } from "./code-chunk-repository.js";

export async function indexRepository(
    name: string,
    url: string
): Promise<{
    repositoryId: string;
    fileCount: number;
    symbolCount: number;
    relationshipCount: number;
    chunkCount: number;
}> {
    const existingRepository = await pool.query<{ id: string }>(
        `
        SELECT id
        FROM repositories
        WHERE name = $1 AND url = $2
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [name, url]
    );

    let createdRepository = false;
    const repositoryResult = existingRepository.rows[0]
        ? existingRepository
        : await pool.query<{ id: string }>(
            `
            INSERT INTO repositories (name, url)
            VALUES ($1, $2)
            RETURNING id
            `,
            [name, url]
        );

    createdRepository = !existingRepository.rows[0];

    const repositoryId = repositoryResult.rows[0].id;

    const repositoryPath = path.join(
        process.cwd(),
        "repositories",
        name
    );

    try {
        await cloneRepository(url, repositoryPath);

        const files = await discoverFiles(repositoryPath);
        await saveFiles(repositoryId, files);

        const savedFiles = await getSavedFiles(repositoryId);
        const fileIdByPath = new Map(
            savedFiles.map(file => [file.path, file.id])
        );

        const parser = await ParserService.initialize();
        const symbolsToSave: SymbolRecord[] = [];
        const parsedFiles: ParsedRepositoryFile[] = [];

        for (const file of files) {
            const fileId = fileIdByPath.get(file.relativePath);

            if (!fileId) {
                throw new Error(
                    `Could not find database ID for file: ${file.relativePath}`
                );
            }

            const parsed = await parser.parseFile(file.path);
            const extracted = extractSymbols(parsed, file.relativePath);

            parsedFiles.push({
                fileId,
                relativePath: file.relativePath,
                parsed
            });

            for (const symbol of extracted) {
                symbolsToSave.push({
                    ...symbol,
                    fileId
                });
            }
        }

        const graphClient = await pool.connect();
        let symbolCount: number;
        let relationshipCount: number;
        let chunkCount: number;

        try {
            await graphClient.query("BEGIN");

            symbolCount = await saveSymbols(
                repositoryId,
                symbolsToSave,
                graphClient
            );
            const savedSymbols = await getSymbols(repositoryId, graphClient);
            const relationships = buildCallRelationships(
                repositoryId,
                parsedFiles,
                savedSymbols
            );
            relationshipCount = await replaceRelationships(
                repositoryId,
                relationships,
                graphClient
            );
            const chunks = buildCodeChunks(repositoryId, parsedFiles, savedSymbols);
            chunkCount = await replaceCodeChunks(repositoryId, chunks, graphClient);

            await graphClient.query(
                `
                UPDATE repositories
                SET indexed_at = CURRENT_TIMESTAMP
                WHERE id = $1
                `,
                [repositoryId]
            );

            await graphClient.query("COMMIT");
        } catch (error) {
            await graphClient.query("ROLLBACK");
            throw error;
        } finally {
            graphClient.release();
        }

        console.info(
            `Indexed ${name}: ${files.length} files discovered, ` +
            `${symbolsToSave.length} symbols extracted, ${symbolCount} symbols saved, ` +
            `${relationshipCount} relationships and ${chunkCount} code chunks saved.`
        );

        return {
            repositoryId,
            fileCount: files.length,
            symbolCount,
            relationshipCount,
            chunkCount
        };
    } catch (error) {
        if (createdRepository) {
            await pool.query(
                "DELETE FROM repositories WHERE id = $1",
                [repositoryId]
            );
        }

        throw error;
    }
}

export interface RepositoryListItem {
    repositoryId: string;
    name: string;
    url: string | null;
    indexingStatus: "INDEXED" | "NOT_INDEXED";
    fileCount: number;
    symbolCount: number;
    createdAt: string;
    indexedAt: string | null;
}

export async function listRepositories(): Promise<RepositoryListItem[]> {
    const result = await pool.query<{
        repositoryId: string; name: string; url: string | null; createdAt: Date; indexedAt: Date | null;
        fileCount: string; symbolCount: string;
    }>(
        `SELECT r.id AS "repositoryId", r.name, r.url, r.created_at AS "createdAt", r.indexed_at AS "indexedAt",
                (SELECT COUNT(*)::text FROM files f WHERE f.repository_id=r.id) AS "fileCount",
                (SELECT COUNT(*)::text FROM symbols s WHERE s.repository_id=r.id) AS "symbolCount"
         FROM repositories r
         ORDER BY COALESCE(r.indexed_at, r.created_at) DESC, r.name, r.id`
    );
    return result.rows.map(row => ({
        repositoryId: row.repositoryId,
        name: row.name,
        url: row.url,
        indexingStatus: row.indexedAt ? "INDEXED" : "NOT_INDEXED",
        fileCount: Number(row.fileCount),
        symbolCount: Number(row.symbolCount),
        createdAt: row.createdAt.toISOString(),
        indexedAt: row.indexedAt?.toISOString() ?? null
    }));
}
