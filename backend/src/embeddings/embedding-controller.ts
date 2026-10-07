import type { Request, Response } from "express";
import { CodeChunkEmbeddingRepository } from "./code-chunk-embedding-repository.js";
import { EmbeddingService } from "./embedding-service.js";
import { GeminiEmbeddingProvider } from "./gemini-embedding-provider.js";
import { validateEmbedding } from "./types.js";

const repository = new CodeChunkEmbeddingRepository();
const service = new EmbeddingService(repository, new GeminiEmbeddingProvider());
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function routeRepositoryId(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export async function generateEmbeddingsHandler(req: Request, res: Response) {
    const repositoryId = routeRepositoryId(req.params.repositoryId);
    if (!uuidPattern.test(repositoryId)) return res.status(400).json({ error: "A valid repositoryId is required." });
    try {
        if (!(await repository.repositoryExists(repositoryId))) return res.status(404).json({ error: "Repository not found." });
        const result = await service.generateMissing(repositoryId);
        if (result.failures.some(failure => failure.error.includes("GEMINI_API_KEY is not configured"))) {
            return res.status(503).json({
                repositoryId, processed: result.processed, created: result.created, failed: result.failed,
                error: "GEMINI_API_KEY is not configured."
            });
        }
        const status = result.failed > 0 ? (result.created > 0 ? 207 : 502) : 200;
        const failureGroups = new Map<string, string[]>();
        for (const failure of result.failures) {
            const ids = failureGroups.get(failure.error) ?? [];
            if (ids.length < 10) ids.push(failure.chunkId);
            failureGroups.set(failure.error, ids);
        }
        return res.status(status).json({
            repositoryId, processed: result.processed, created: result.created, failed: result.failed,
            failures: [...failureGroups].map(([error, chunkIds]) => ({ error, chunkIds }))
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Embedding generation failed.";
        const status = message.includes("GEMINI_API_KEY is not configured") ? 503 : 502;
        return res.status(status).json({ error: message });
    }
}

export async function semanticSearchHandler(req: Request, res: Response) {
    const repositoryId = routeRepositoryId(req.params.repositoryId);
    if (!uuidPattern.test(repositoryId)) return res.status(400).json({ error: "A valid repositoryId is required." });
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) return res.status(400).json({ error: "A non-empty query is required." });
    const limit = req.body?.limit === undefined ? 5 : req.body.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return res.status(400).json({ error: "limit must be an integer between 1 and 50." });
    }
    try {
        if (!(await repository.repositoryExists(repositoryId))) return res.status(404).json({ error: "Repository not found." });
        const counts = await repository.countEmbeddings(repositoryId);
        if (counts.embedded === 0) {
            return res.status(409).json({ error: "This repository has no embeddings. Generate embeddings before searching." });
        }
        const vector = await service.embedQuery(query);
        validateEmbedding(vector);
        const results = await repository.search(repositoryId, vector, limit);
        return res.json({ repositoryId, query, limit, results });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Semantic search failed.";
        const status = message.includes("GEMINI_API_KEY is not configured") ? 503 : 502;
        return res.status(status).json({ error: message });
    }
}
