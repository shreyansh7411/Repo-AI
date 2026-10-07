import { Request, Response } from "express";
import { indexRepository } from "./services/repository-service.js";

export async function indexRepositoryHandler(
    req: Request,
    res: Response
) {
    try {
        const { name, url } = req.body;

        if (!name || !url) {
            return res.status(400).json({
                error: "Repository name and URL are required"
            });
        }

        const result = await indexRepository(name, url);

        return res.status(201).json({
            message: "Repository indexed successfully",
            repositoryId: result.repositoryId,
            fileCount: result.fileCount,
            symbolCount: result.symbolCount,
            relationshipCount: result.relationshipCount,
            chunkCount: result.chunkCount
        });
    } catch (error) {
        console.error("Repository indexing failed:", error);

        return res.status(500).json({
            error: "Failed to index repository"
        });
    }
}
