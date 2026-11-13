import { Request, Response } from "express";
import { indexRepository, listRepositories } from "./services/repository-service.js";
import { validateGitUrl, validateRepositoryName } from "./services/repository-storage.js";

export async function listRepositoriesHandler(_req: Request, res: Response) {
    try {
        return res.json({ repositories: await listRepositories() });
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

        const result = await indexRepository(validatedName, validatedUrl);

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
