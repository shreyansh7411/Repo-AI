import type { Request, Response } from "express";
import { CodeChunkEmbeddingRepository } from "../embeddings/code-chunk-embedding-repository.js";
import { EmbeddingService } from "../embeddings/embedding-service.js";
import { GeminiEmbeddingProvider } from "../embeddings/gemini-embedding-provider.js";
import { GeminiLLMProvider } from "../ai/gemini-llm-provider.js";
import { HybridRetrievalService } from "./hybrid-retrieval-service.js";
import { StructuralRetrievalRepository } from "./structural-retrieval-repository.js";
import { AssistantService } from "./assistant-service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const chunks = new CodeChunkEmbeddingRepository();
const embeddings = new EmbeddingService(chunks, new GeminiEmbeddingProvider());
const structural = new StructuralRetrievalRepository();
const retrieval = new HybridRetrievalService(chunks, embeddings, structural);
const assistant = new AssistantService(retrieval, new GeminiLLMProvider());

function routeId(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function options(body: Record<string, unknown>) {
    const topK = body.topK ?? body.limit ?? 6;
    const maxDepth = body.maxDepth ?? 1;
    if (!Number.isInteger(topK) || Number(topK) < 1 || Number(topK) > 20) throw new Error("topK must be an integer between 1 and 20.");
    if (!Number.isInteger(maxDepth) || Number(maxDepth) < 0 || Number(maxDepth) > 2) throw new Error("maxDepth must be an integer between 0 and 2.");
    return { topK: Number(topK), maxDepth: Number(maxDepth) };
}

export async function retrieveHandler(req: Request, res: Response) {
    const repositoryId = routeId(req.params.repositoryId);
    if (!uuidPattern.test(repositoryId)) return res.status(400).json({ error: "A valid repositoryId is required." });
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) return res.status(400).json({ error: "A non-empty query is required." });
    let retrievalOptions;
    try { retrievalOptions = options(req.body ?? {}); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid retrieval options." }); }
    try {
        if (!(await structural.repositoryExists(repositoryId))) return res.status(404).json({ error: "Repository not found." });
        const result = await retrieval.retrieve(repositoryId, query, retrievalOptions);
        return res.json({ ...result, insufficientEvidence: result.evidence.length === 0 });
    } catch (error) { return retrievalError(res, error); }
}

export async function askHandler(req: Request, res: Response) {
    const repositoryId = routeId(req.params.repositoryId);
    if (!uuidPattern.test(repositoryId)) return res.status(400).json({ error: "A valid repositoryId is required." });
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!question) return res.status(400).json({ error: "A non-empty question is required." });
    let askOptions;
    try { askOptions = options(req.body ?? {}); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid ask options." }); }
    try {
        if (!(await structural.repositoryExists(repositoryId))) return res.status(404).json({ error: "Repository not found." });
        return res.json(await assistant.ask(repositoryId, question, askOptions));
    } catch (error) { return retrievalError(res, error); }
}

function retrievalError(res: Response, error: unknown) {
    const message = error instanceof Error ? error.message : "Repository retrieval failed.";
    const status = message.includes("GEMINI_API_KEY is not configured") ? 503
        : message.includes("Repository not found") ? 404 : message.includes("must be") ? 400
            : message.includes("HTTP 429") ? 429 : 502;
    return res.status(status).json({ error: message });
}
