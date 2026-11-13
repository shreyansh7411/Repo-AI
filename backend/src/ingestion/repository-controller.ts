import { Request, Response } from "express";
import { deleteRepository, getRepository, indexRepository, listRepositories } from "./services/repository-service.js";
import { validateGitUrl, validateRepositoryName } from "./services/repository-storage.js";
import { repositoryIdFromRoute } from "./repository-ownership.js";

export async function listRepositoriesHandler(_req: Request, res: Response) {
    try {
        const ownerUserId = _req.auth?.userId;
        if (!ownerUserId) return res.status(401).json({ error: "Authentication required." });
        return res.json({ repositories: await listRepositories(ownerUserId) });
    } catch {
        return res.status(500).json({ error: "Failed to load repositories" });
    }
}

export async function indexRepositoryHandler(
    req: Request,
    res: Response
) {
    try {
        const { name, url } = req.body;

        let validatedName: string;
        let validatedUrl: string;
        try {
            validatedName = validateRepositoryName(name);
            validatedUrl = validateGitUrl(url);
        } catch (error) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : "Repository name or URL is invalid"
            });
        }

        const ownerUserId = req.auth?.userId;
        if (!ownerUserId) return res.status(401).json({ error: "Authentication required." });
        const result = await indexRepository(validatedName, validatedUrl, ownerUserId);

        return res.status(201).json({
            message: "Repository indexed successfully",
            repositoryId: result.repositoryId,
            fileCount: result.fileCount,
            symbolCount: result.symbolCount,
            relationshipCount: result.relationshipCount,
            chunkCount: result.chunkCount
        });
    } catch {
        console.error("Repository indexing failed; sensitive request details were omitted.");

        return res.status(500).json({
            error: "Failed to index repository"
        });
    }
}

export async function getRepositoryHandler(req: Request, res: Response) {
    const ownerUserId = req.auth?.userId;
    if (!ownerUserId) return res.status(401).json({ error: "Authentication required." });
    const repositoryId = repositoryIdFromRoute(req.params.repositoryId);
    if (!repositoryId) return res.status(400).json({ error: { code: "INVALID_REPOSITORY_ID", message: "A valid repositoryId is required." } });
    try {
        const repository = await getRepository(repositoryId, ownerUserId);
        if (!repository) return res.status(404).json({ error: { code: "REPOSITORY_NOT_FOUND", message: "Repository was not found." } });
        return res.json({ repository });
    } catch {
        return res.status(500).json({ error: { code: "REPOSITORY_LOOKUP_FAILED", message: "Repository could not be loaded." } });
    }
}

export async function deleteRepositoryHandler(req: Request, res: Response) {
    const ownerUserId = req.auth?.userId;
    if (!ownerUserId) return res.status(401).json({ error: "Authentication required." });
    const repositoryId = repositoryIdFromRoute(req.params.repositoryId);
    if (!repositoryId) return res.status(400).json({ error: { code: "INVALID_REPOSITORY_ID", message: "A valid repositoryId is required." } });
    try {
        const result = await deleteRepository(repositoryId, ownerUserId);
        if (!result.deleted) return res.status(404).json({ error: { code: "REPOSITORY_NOT_FOUND", message: "Repository was not found." } });
        return res.json({ repositoryId, deleted: true, storageCleanupPending: result.storageCleanupPending });
    } catch {
        return res.status(500).json({ error: { code: "REPOSITORY_DELETE_FAILED", message: "Repository could not be deleted." } });
    }
}
