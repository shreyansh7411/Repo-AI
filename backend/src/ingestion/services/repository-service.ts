import { opendir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pool } from "../../config/database.js";
import { cloneRepository } from "./repository-cloner.js";
import {
    getRepositoryClonePath,
    getDemoRepositoryClonePath,
    sanitizeGitUrl,
    validateGitUrl,
    validateRepositoryName
} from "./repository-storage.js";
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

export interface RepositoryIndexResult {
    repositoryId: string;
    fileCount: number;
    symbolCount: number;
    relationshipCount: number;
    chunkCount: number;
}

export interface DemoIndexLimits {
    maxFiles: number;
    maxFilesystemEntries: number;
    maxFileBytes: number;
    maxRepositoryBytes: number;
    maxDurationMs: number;
}

type RepositoryIndexScope = { ownerUserId: string; demoSessionId?: never } | { ownerUserId?: never; demoSessionId: string };

export function indexRepository(name: string, url: string, ownerUserId: string): Promise<RepositoryIndexResult> {
    return indexRepositoryWithScope(name, url, { ownerUserId });
}

export function indexDemoRepository(name: string, url: string, demoSessionId: string, limits: DemoIndexLimits): Promise<RepositoryIndexResult> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(demoSessionId)) {
        throw new Error("A valid demo session is required to index a repository");
    }
    return indexRepositoryWithScope(name, url, { demoSessionId }, limits);
}

async function indexRepositoryWithScope(
    name: string,
    url: string,
    scope: RepositoryIndexScope,
    demoLimits?: DemoIndexLimits
): Promise<RepositoryIndexResult> {
    const repositoryName = validateRepositoryName(name);
    const cloneUrl = validateGitUrl(url);
    const storedUrl = sanitizeGitUrl(cloneUrl);
    const ownerUserId = scope.ownerUserId;
    const demoSessionId = scope.demoSessionId;
    const scopeId = ownerUserId ?? demoSessionId;
    if (!scopeId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scopeId)) throw new Error("A valid repository indexing scope is required");

    const existingRepository = ownerUserId
        ? await pool.query<{ id: string }>(
            `SELECT id FROM repositories WHERE name = $1 AND url = $2 AND owner_user_id = $3 ORDER BY created_at DESC LIMIT 1`,
            [repositoryName, storedUrl, ownerUserId]
        )
        : await pool.query<{ id: string }>(
            `SELECT id FROM repositories WHERE name = $1 AND url = $2 AND demo_session_id = $3 ORDER BY created_at DESC LIMIT 1`,
            [repositoryName, storedUrl, demoSessionId]
        );

    let createdRepository = false;
    const repositoryResult = existingRepository.rows[0]
        ? existingRepository
        : ownerUserId
            ? await pool.query<{ id: string }>(
                `INSERT INTO repositories (name, url, owner_user_id) VALUES ($1, $2, $3) RETURNING id`,
                [repositoryName, storedUrl, ownerUserId]
            )
            : await pool.query<{ id: string }>(
                `INSERT INTO repositories (name, url, owner_user_id, demo_session_id) VALUES ($1, $2, NULL, $3) RETURNING id`,
                [repositoryName, storedUrl, demoSessionId]
            );

    createdRepository = !existingRepository.rows[0];

    const repositoryId = repositoryResult.rows[0].id;

    const repositoryPath = demoSessionId ? getDemoRepositoryClonePath(repositoryId) : getRepositoryClonePath(repositoryId);
    const deadline = demoLimits ? Date.now() + demoLimits.maxDurationMs : Number.POSITIVE_INFINITY;
    const checkDeadline = () => {
        if (Date.now() > deadline) throw new Error("Demo indexing exceeded the configured time limit.");
    };

    try {
        await cloneRepository(cloneUrl, repositoryPath, demoLimits ? {
            timeoutMs: Math.max(1, deadline - Date.now()),
            shallow: true,
            maxBytes: demoLimits.maxRepositoryBytes,
            maxEntries: demoLimits.maxFilesystemEntries
        } : {});
        checkDeadline();

        if (demoLimits) {
            const pending = [repositoryPath];
            let cloneBytes = 0;
            let cloneEntries = 0;
            while (pending.length > 0) {
                checkDeadline();
                const current = pending.pop()!;
                const directory = await opendir(current);
                for await (const entry of directory) {
                    checkDeadline();
                    cloneEntries += 1;
                    if (cloneEntries > demoLimits.maxFilesystemEntries) {
                        throw new Error("Repository exceeds the configured demo filesystem-entry limit.");
                    }
                    const entryPath = path.join(current, entry.name);
                    if (entry.isDirectory()) pending.push(entryPath);
                    else if (entry.isFile()) {
                        cloneBytes += (await stat(entryPath)).size;
                        checkDeadline();
                        if (cloneBytes > demoLimits.maxRepositoryBytes) throw new Error("Repository exceeds the configured demo size limit.");
                    }
                }
            }
        }

        const files = await discoverFiles(repositoryPath, demoLimits ? {
            maxFiles: demoLimits.maxFiles,
            maxFileBytes: demoLimits.maxFileBytes,
            maxSourceBytes: demoLimits.maxRepositoryBytes,
            maxFilesystemEntries: demoLimits.maxFilesystemEntries,
            deadlineAt: deadline,
            ignoreSymlinks: true
        } : undefined);
        checkDeadline();
        await saveFiles(repositoryId, files);
        checkDeadline();

        const savedFiles = await getSavedFiles(repositoryId);
        checkDeadline();
        const fileIdByPath = new Map(
            savedFiles.map(file => [file.path, file.id])
        );

        const parser = await ParserService.initialize();
        checkDeadline();
        const symbolsToSave: SymbolRecord[] = [];
        const parsedFiles: ParsedRepositoryFile[] = [];

        for (const file of files) {
            checkDeadline();
            const fileId = fileIdByPath.get(file.relativePath);

            if (!fileId) {
                throw new Error(
                    `Could not find database ID for file: ${file.relativePath}`
                );
            }

            const parsed = await parser.parseFile(file.path);
            checkDeadline();
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
            checkDeadline();
            await graphClient.query("BEGIN");

            symbolCount = await saveSymbols(
                repositoryId,
                symbolsToSave,
                graphClient
            );
            checkDeadline();
            const savedSymbols = await getSymbols(repositoryId, graphClient);
            checkDeadline();
            const relationships = buildCallRelationships(
                repositoryId,
                parsedFiles,
                savedSymbols
            );
            checkDeadline();
            relationshipCount = await replaceRelationships(
                repositoryId,
                relationships,
                graphClient
            );
            checkDeadline();
            const chunks = buildCodeChunks(repositoryId, parsedFiles, savedSymbols);
            checkDeadline();
            chunkCount = await replaceCodeChunks(repositoryId, chunks, graphClient);
            checkDeadline();

            if (ownerUserId) {
                await graphClient.query(`UPDATE repositories SET indexed_at = CURRENT_TIMESTAMP WHERE id = $1 AND owner_user_id = $2`, [repositoryId, ownerUserId]);
            } else {
                await graphClient.query(`UPDATE repositories SET indexed_at = CURRENT_TIMESTAMP WHERE id = $1 AND demo_session_id = $2 AND owner_user_id IS NULL`, [repositoryId, demoSessionId]);
            }

            checkDeadline();
            await graphClient.query("COMMIT");
        } catch (error) {
            await graphClient.query("ROLLBACK");
            throw error;
        } finally {
            graphClient.release();
        }

        console.info(
            `Indexed ${repositoryName}: ${files.length} files discovered, ` +
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
        if (demoSessionId) {
            let cloneRemoved = false;
            try {
                await rm(repositoryPath, { recursive: true, force: true });
                cloneRemoved = true;
            } catch (cleanupError) {
                console.error("Demo clone cleanup failed; the cleanup worker will retry.", cleanupError);
            }
            if (cloneRemoved && createdRepository) {
                await pool.query("DELETE FROM repositories WHERE id = $1 AND demo_session_id = $2 AND owner_user_id IS NULL", [repositoryId, demoSessionId]);
            }
        } else if (createdRepository && ownerUserId) {
            await pool.query("DELETE FROM repositories WHERE id = $1 AND owner_user_id = $2", [repositoryId, ownerUserId]);
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

export async function listRepositories(ownerUserId: string): Promise<RepositoryListItem[]> {
    const result = await pool.query<{
        repositoryId: string; name: string; url: string | null; createdAt: Date; indexedAt: Date | null;
        fileCount: string; symbolCount: string;
    }>(
        `SELECT r.id AS "repositoryId", r.name, r.url, r.created_at AS "createdAt", r.indexed_at AS "indexedAt",
                (SELECT COUNT(*)::text FROM files f WHERE f.repository_id=r.id) AS "fileCount",
                (SELECT COUNT(*)::text FROM symbols s WHERE s.repository_id=r.id) AS "symbolCount"
         FROM repositories r
         WHERE r.owner_user_id = $1
         ORDER BY COALESCE(r.indexed_at, r.created_at) DESC, r.name, r.id`,
        [ownerUserId]
    );
    return result.rows.map(row => ({
        repositoryId: row.repositoryId,
        name: row.name,
        url: row.url ? sanitizeGitUrl(row.url) : null,
        indexingStatus: row.indexedAt ? "INDEXED" : "NOT_INDEXED",
        fileCount: Number(row.fileCount),
        symbolCount: Number(row.symbolCount),
        createdAt: row.createdAt.toISOString(),
        indexedAt: row.indexedAt?.toISOString() ?? null
    }));
}

export interface RepositoryDetails extends RepositoryListItem {
    branch: string | null;
    commitHash: string | null;
}

export async function getRepository(repositoryId: string, ownerUserId: string): Promise<RepositoryDetails | null> {
    const result = await pool.query<{
        repositoryId: string; name: string; url: string | null; branch: string | null; commitHash: string | null;
        createdAt: Date; indexedAt: Date | null; fileCount: string; symbolCount: string;
    }>(
        `SELECT r.id AS "repositoryId", r.name, r.url, r.branch, r.commit_hash AS "commitHash",
                r.created_at AS "createdAt", r.indexed_at AS "indexedAt",
                (SELECT COUNT(*)::text FROM files f WHERE f.repository_id=r.id) AS "fileCount",
                (SELECT COUNT(*)::text FROM symbols s WHERE s.repository_id=r.id) AS "symbolCount"
         FROM repositories r
         WHERE r.id = $1 AND r.owner_user_id = $2`,
        [repositoryId, ownerUserId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
        repositoryId: row.repositoryId, name: row.name, url: row.url ? sanitizeGitUrl(row.url) : null, branch: row.branch,
        commitHash: row.commitHash, indexingStatus: row.indexedAt ? "INDEXED" : "NOT_INDEXED",
        fileCount: Number(row.fileCount), symbolCount: Number(row.symbolCount),
        createdAt: row.createdAt.toISOString(), indexedAt: row.indexedAt?.toISOString() ?? null
    };
}

export async function deleteRepository(repositoryId: string, ownerUserId: string): Promise<{ deleted: boolean; storageCleanupPending: boolean }> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const deleted = await client.query<{ id: string }>(
            "DELETE FROM repositories WHERE id = $1 AND owner_user_id = $2 RETURNING id",
            [repositoryId, ownerUserId]
        );
        if (!deleted.rows[0]) {
            await client.query("ROLLBACK");
            return { deleted: false, storageCleanupPending: false };
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }

    try {
        await rm(getRepositoryClonePath(repositoryId), { recursive: true, force: true });
        return { deleted: true, storageCleanupPending: false };
    } catch {
        console.error("Repository clone cleanup failed after database deletion.");
        return { deleted: true, storageCleanupPending: true };
    }
}
