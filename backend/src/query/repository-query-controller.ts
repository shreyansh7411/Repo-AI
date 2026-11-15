import type { Request, Response } from "express";
import { CodeChunkEmbeddingRepository } from "../embeddings/code-chunk-embedding-repository.js";
import { EmbeddingService } from "../embeddings/embedding-service.js";
import { GeminiEmbeddingProvider } from "../embeddings/gemini-embedding-provider.js";
import { GraphRepository } from "../graph/graph-repository.js";
import { GraphAnalysisError, GraphTraversalService } from "../graph/graph-traversal-service.js";
import { RELATIONSHIP_TYPES, type RelationshipType } from "../graph/types.js";
import { HybridRetrievalService } from "../retrieval/hybrid-retrieval-service.js";
import { StructuralRetrievalRepository } from "../retrieval/structural-retrieval-repository.js";
import type { SymbolType } from "../parser/symbol-types.js";
import { RepositoryQueryRepository } from "./repository-query-repository.js";
import { RepositoryQueryError, RepositoryQueryService } from "./repository-query-service.js";
import type { RepositorySearchMode } from "./types.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const chunkRepository = new CodeChunkEmbeddingRepository();
const embeddingService = new EmbeddingService(chunkRepository, new GeminiEmbeddingProvider());
const structuralRepository = new StructuralRetrievalRepository();
const graphService = new GraphTraversalService(new GraphRepository());
const queryService = new RepositoryQueryService({
    metadata: new RepositoryQueryRepository(), embeddings: embeddingService, chunks: chunkRepository,
    structural: structuralRepository, hybrid: new HybridRetrievalService(chunkRepository, embeddingService, structuralRepository),
    graph: graphService
});

type Handler = (req: Request, res: Response) => Promise<unknown>;

export function createRepositoryQueryHandlers(service: RepositoryQueryService) {
    const handle = (action: (repositoryId: string, body: Record<string, unknown>, req: Request) => Promise<unknown>): Handler => async (req, res) => {
        const repositoryId = routeValue(req.params.repositoryId);
        if (!uuidPattern.test(repositoryId)) return res.status(400).json({ error: { code: "INVALID_REPOSITORY_ID", message: "A valid repositoryId is required." } });
        const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
        try {
            return res.json(await action(repositoryId, body, req));
        } catch (error) {
            if (error instanceof InvalidQueryRequest) return res.status(400).json({ error: { code: "INVALID_REQUEST", message: error.message } });
            if (error instanceof RepositoryQueryError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
            if (error instanceof GraphAnalysisError) return res.status(404).json({ error: { code: error.code, message: error.message } });
            if (error instanceof Error && "code" in error && (error as { code?: string }).code === "SYMBOL_NOT_FOUND") {
                return res.status(404).json({ error: { code: "SYMBOL_NOT_FOUND", message: "Symbol was not found in this repository." } });
            }
            return res.status(500).json({ error: { code: "REPOSITORY_QUERY_FAILED", message: "Repository query could not be completed." } });
        }
    };

    return {
        symbol: handle((repositoryId, body) => service.symbol(repositoryId, uuid(body.symbolId, "symbolId"))),
        symbols: handle((repositoryId, _body, req) => service.listSymbols(repositoryId, symbolListOptions(req.query))),
        file: handle((repositoryId, body) => service.file(repositoryId, filePath(body.path))),
        search: handle((repositoryId, body) => service.search(repositoryId, queryText(body.query), searchMode(body.mode), topK(body.topK), depth(body.maxDepth, 1))),
        trace: handle((repositoryId, body) => service.trace(repositoryId, uuid(body.symbolId, "symbolId"), direction(body.direction), depth(body.maxDepth, 1))),
        impact: handle((repositoryId, body) => service.impact(repositoryId, uuid(body.symbolId, "symbolId"), depth(body.maxDepth, 1))),
        path: handle((repositoryId, body) => service.path(repositoryId, uuid(body.fromSymbolId, "fromSymbolId"), uuid(body.toSymbolId, "toSymbolId"),
            depth(body.maxDepth, 5), relationshipTypes(body)))
    };
}

class InvalidQueryRequest extends Error {}
function routeValue(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function uuid(value: unknown, label: string): string {
    if (typeof value !== "string" || !uuidPattern.test(value)) throw new InvalidQueryRequest(`${label} must be a valid UUID.`);
    return value;
}
function queryText(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 4000) throw new InvalidQueryRequest("query must be a non-empty string no longer than 4000 characters.");
    return value.trim();
}
function filePath(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 2000 || /[\u0000-\u001f]/.test(value)) {
        throw new InvalidQueryRequest("path must be a non-empty repository-relative path.");
    }
    return value.trim().replace(/\\/g, "/");
}
function searchMode(value: unknown): RepositorySearchMode {
    if (value !== "semantic" && value !== "structural" && value !== "hybrid") throw new InvalidQueryRequest("mode must be semantic, structural, or hybrid.");
    return value;
}
function direction(value: unknown): "callers" | "callees" {
    if (value !== "callers" && value !== "callees") throw new InvalidQueryRequest("direction must be callers or callees.");
    return value;
}
function topK(value: unknown): number {
    const parsed = value ?? 5;
    if (!Number.isInteger(parsed) || Number(parsed) < 1 || Number(parsed) > 20) throw new InvalidQueryRequest("topK must be an integer between 1 and 20.");
    return Number(parsed);
}
function depth(value: unknown, fallback: number): number {
    const parsed = value ?? fallback;
    if (!Number.isInteger(parsed) || Number(parsed) < 1 || Number(parsed) > 5) throw new InvalidQueryRequest("maxDepth must be an integer between 1 and 5.");
    return Number(parsed);
}
function relationshipTypes(body: Record<string, unknown>): RelationshipType[] {
    const value = body.relationshipTypes;
    if (value === undefined) return ["CALLS"];
    if (!Array.isArray(value) || value.length === 0 || value.some(type => typeof type !== "string" || !RELATIONSHIP_TYPES.includes(type as RelationshipType))) {
        throw new InvalidQueryRequest(`relationshipTypes must be a non-empty array containing only ${RELATIONSHIP_TYPES.join(", ")}.`);
    }
    return [...new Set(value as RelationshipType[])].sort();
}

const SYMBOL_TYPES: readonly SymbolType[] = ["CLASS", "INTERFACE", "ENUM", "METHOD", "CONSTRUCTOR", "FUNCTION", "FIELD", "VARIABLE"];
function queryParam(value: unknown, name: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new InvalidQueryRequest(`${name} must be supplied once as a string.`);
    return value;
}
function symbolListOptions(query: Request["query"]) {
    const pageText = queryParam(query.page, "page");
    const pageSizeText = queryParam(query.pageSize, "pageSize");
    const page = pageText === undefined ? 1 : Number(pageText);
    const pageSize = pageSizeText === undefined ? 50 : Number(pageSizeText);
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000) throw new InvalidQueryRequest("page must be an integer between 1 and 1000000.");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new InvalidQueryRequest("pageSize must be an integer between 1 and 100.");
    const typeText = queryParam(query.type, "type");
    if (typeText !== undefined && !SYMBOL_TYPES.includes(typeText as SymbolType)) {
        throw new InvalidQueryRequest(`type must be one of ${SYMBOL_TYPES.join(", ")}.`);
    }
    const searchText = queryParam(query.search, "search")?.trim() ?? "";
    if (searchText.length > 100 || /[\u0000-\u001f]/.test(searchText)) throw new InvalidQueryRequest("search must be no longer than 100 characters.");
    return { page, pageSize, type: (typeText as SymbolType | undefined) ?? null, search: searchText || null };
}

const handlers = createRepositoryQueryHandlers(queryService);
export const symbolQueryHandler = handlers.symbol;
export const symbolsQueryHandler = handlers.symbols;
export const fileQueryHandler = handlers.file;
export const searchQueryHandler = handlers.search;
export const traceQueryHandler = handlers.trace;
export const impactQueryHandler = handlers.impact;
export const pathQueryHandler = handlers.path;
