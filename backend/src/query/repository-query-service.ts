import type { CodeChunkEmbeddingRepository } from "../embeddings/code-chunk-embedding-repository.js";
import type { EmbeddingService } from "../embeddings/embedding-service.js";
import type { SearchChunk } from "../embeddings/types.js";
import type { GraphTraversalService } from "../graph/graph-traversal-service.js";
import type { RelationshipType } from "../graph/types.js";
import type { HybridRetrievalService } from "../retrieval/hybrid-retrieval-service.js";
import type { StructuralRetrievalRepository } from "../retrieval/structural-retrieval-repository.js";
import type { StructuralRelationship, StructuralSymbol } from "../retrieval/types.js";
import type { RepositoryQueryRepository } from "./repository-query-repository.js";
import type { RepositoryEvidence, RepositoryPathResult, RepositorySearchMode, RepositorySearchResult, RepositorySymbol, RepositoryTraceResult } from "./types.js";

export class RepositoryQueryError extends Error {
    constructor(readonly status: 400 | 404 | 503 | 502, readonly code: string, message: string) { super(message); }
}

export interface RepositoryQueryDependencies {
    metadata: Pick<RepositoryQueryRepository, "repositoryExists" | "getSymbol" | "getFile">;
    embeddings: Pick<EmbeddingService, "embedQuery">;
    chunks: Pick<CodeChunkEmbeddingRepository, "search">;
    structural: Pick<StructuralRetrievalRepository, "findMatchingSymbols" | "expand" | "getSymbolChunks">;
    hybrid: Pick<HybridRetrievalService, "retrieve">;
    graph: Pick<GraphTraversalService, "trace" | "impact" | "shortestPath">;
}

export class RepositoryQueryService {
    constructor(private readonly deps: RepositoryQueryDependencies) {}

    async symbol(repositoryId: string, symbolId: string): Promise<RepositorySymbol> {
        await this.requireRepository(repositoryId);
        const result = await this.deps.metadata.getSymbol(repositoryId, symbolId);
        if (!result) throw new RepositoryQueryError(404, "SYMBOL_NOT_FOUND", "Symbol was not found in this repository.");
        return result;
    }

    async file(repositoryId: string, path: string) {
        await this.requireRepository(repositoryId);
        const result = await this.deps.metadata.getFile(repositoryId, path);
        if (!result) throw new RepositoryQueryError(404, "FILE_NOT_FOUND", "File was not found in this repository.");
        return result;
    }

    async search(repositoryId: string, query: string, mode: RepositorySearchMode, topK: number, maxDepth: number): Promise<RepositorySearchResult> {
        await this.requireRepository(repositoryId);
        if (mode === "semantic") return this.semanticSearch(repositoryId, query, topK, maxDepth);
        if (mode === "structural") {
            const evidence = await this.structuralSearch(repositoryId, query, topK, maxDepth);
            return { repositoryId, query, mode, topK, maxDepth, semanticAvailable: null, evidence };
        }
        // Existing hybrid retrieval intentionally caps graph expansion at depth 2.
        const effectiveMaxDepth = Math.min(maxDepth, 2);
        const result = await this.deps.hybrid.retrieve(repositoryId, query, { topK, maxDepth: effectiveMaxDepth });
        const semanticError = result.semanticError ? safeSemanticError(result.semanticError) : undefined;
        const relationships = new Map(result.relationships.map(edge => [edge.id, edge]));
        const semanticChunks = new Map(result.semantic.map(chunk => [chunk.id, chunk]));
        return { repositoryId, query, mode, topK, maxDepth,
            ...(effectiveMaxDepth === maxDepth ? {} : { effectiveMaxDepth }), semanticAvailable: !semanticError,
            ...(semanticError ? { semanticError } : {}), evidence: result.evidence.map(item => {
                const edgeId = item.relationship?.id;
                const edge = edgeId ? relationships.get(edgeId) : undefined;
                if (edge) return relationshipEvidence(edge);
                const chunkId = item.id.replace(/^chunk:/, "");
                const chunk = semanticChunks.get(chunkId);
                const symbol = item.symbolId ? result.symbols.find(candidate => candidate.id === item.symbolId) : undefined;
                return normalizeHybridEvidence(item, chunk?.fileId ?? symbol?.fileId ?? "", symbol?.language ?? null);
            }) };
    }

    async trace(repositoryId: string, symbolId: string, direction: "callers" | "callees", maxDepth: number): Promise<RepositoryTraceResult> {
        await this.requireRepository(repositoryId);
        const traced = await this.deps.graph.trace(repositoryId, symbolId, direction === "callers" ? "INCOMING" : "OUTGOING", maxDepth, ["CALLS"]);
        return { repositoryId, direction, target: traced.target, maxDepth, results: traced.results.map((hit) => ({
            symbol: hit.symbol,
            file: { id: hit.symbol.fileId, path: hit.symbol.filePath, language: hit.symbol.language },
            depth: hit.depth,
            relationship: hit.relationship
        })) };
    }

    async impact(repositoryId: string, symbolId: string, maxDepth: number) {
        await this.requireRepository(repositoryId);
        return this.deps.graph.impact(repositoryId, symbolId, maxDepth);
    }

    async path(repositoryId: string, fromSymbolId: string, toSymbolId: string, maxDepth: number): Promise<RepositoryPathResult> {
        await this.requireRepository(repositoryId);
        const result = await this.deps.graph.shortestPath(repositoryId, fromSymbolId, toSymbolId, maxDepth,
            ["CALLS", "IMPORTS", "IMPLEMENTS", "EXTENDS"]);
        return { repositoryId, found: result.found, pathLength: result.found ? Math.max(0, result.steps.length - 1) : 0,
            maxDepth, steps: result.steps.map(step => ({ ...step,
                file: { id: step.symbol.fileId, path: step.symbol.filePath, language: step.symbol.language } })) };
    }

    private async semanticSearch(repositoryId: string, query: string, topK: number, maxDepth: number): Promise<RepositorySearchResult> {
        let vector: number[];
        try {
            vector = await this.deps.embeddings.embedQuery(query);
        } catch (error) {
            const semanticError = safeSemanticError(error instanceof Error ? error.message : "Semantic retrieval failed.");
            // Match the existing hybrid path: deterministic structural evidence remains available on provider failure.
            const evidence = await this.structuralSearch(repositoryId, query, topK, maxDepth);
            return { repositoryId, query, mode: "semantic", topK, maxDepth, semanticAvailable: false, semanticError, evidence };
        }
        const chunks = await this.deps.chunks.search(repositoryId, vector, topK);
        return { repositoryId, query, mode: "semantic", topK, maxDepth, semanticAvailable: true,
            evidence: chunks.map(chunk => chunkEvidence(chunk)) };
    }

    private async structuralSearch(repositoryId: string, query: string, topK: number, maxDepth: number): Promise<RepositoryEvidence[]> {
        const matches = await this.deps.structural.findMatchingSymbols(repositoryId, query, topK);
        const graph = await this.deps.structural.expand(repositoryId, matches.map(symbol => symbol.id), maxDepth);
        const chunks = await this.deps.structural.getSymbolChunks(repositoryId, graph.symbols.map(symbol => symbol.id));
        const evidence = chunks.slice(0, topK).map(row => structuralChunkEvidence(row, matches, graph.symbols));
        evidence.push(...graph.relationships.map(edge => relationshipEvidence(edge)));
        return evidence;
    }

    private async requireRepository(repositoryId: string): Promise<void> {
        if (!(await this.deps.metadata.repositoryExists(repositoryId))) {
            throw new RepositoryQueryError(404, "REPOSITORY_NOT_FOUND", "Repository was not found.");
        }
    }
}

function chunkEvidence(chunk: SearchChunk): RepositoryEvidence {
    return { kind: "CODE_CHUNK", source: "SEMANTIC",
        file: { id: chunk.fileId, path: chunk.filePath, language: null },
        symbol: chunk.symbolId && chunk.symbolName ? { id: chunk.symbolId, name: chunk.symbolName, type: chunk.symbolType ?? "UNKNOWN" } : null,
        startLine: chunk.startLine, endLine: chunk.endLine, content: chunk.content, chunkId: chunk.id, similarity: Number(chunk.similarity) };
}

function normalizeHybridEvidence(item: { kind: "CHUNK" | "RELATIONSHIP"; provenance: "SEMANTIC" | "STRUCTURAL" | "BOTH"; filePath: string; symbolId: string | null; symbol: string | null; symbolType: string | null; startLine: number; endLine: number; content: string; similarity?: number; relationship?: { id: string; type: string; source: string; target: string }; id: string }, fileId: string, language: string | null): RepositoryEvidence {
    return { kind: item.kind === "RELATIONSHIP" ? "RELATIONSHIP" : "CODE_CHUNK", source: item.provenance,
        file: { id: fileId, path: item.filePath, language },
        symbol: item.symbolId && item.symbol ? { id: item.symbolId, name: item.symbol, type: item.symbolType ?? "UNKNOWN" } : null,
        startLine: item.startLine, endLine: item.endLine, content: item.content,
        ...(item.kind === "CHUNK" ? { chunkId: item.id.replace(/^chunk:/, "") } : {}),
        ...(item.similarity === undefined ? {} : { similarity: item.similarity }) };
}

function structuralChunkEvidence(row: Record<string, unknown>, matches: StructuralSymbol[], symbols: StructuralSymbol[]): RepositoryEvidence {
    const symbolId = row.symbolId ? String(row.symbolId) : null;
    const symbol = symbols.find(item => item.id === symbolId) ?? matches.find(item => item.id === symbolId);
    return { kind: "CODE_CHUNK", source: "STRUCTURAL",
        file: { id: String(row.fileId), path: String(row.filePath), language: symbol?.language ?? null },
        symbol: symbolId && row.symbolName ? { id: symbolId, name: String(row.symbolName), type: String(row.symbolType ?? "UNKNOWN") } : null,
        startLine: Number(row.startLine), endLine: Number(row.endLine), content: String(row.content), chunkId: String(row.id) };
}

function relationshipEvidence(edge: StructuralRelationship): RepositoryEvidence {
    const source = edge.source, target = edge.target;
    return { kind: "RELATIONSHIP", source: "STRUCTURAL",
        file: { id: source.fileId, path: source.filePath, language: source.language ?? null },
        symbol: { id: source.id, name: source.name, type: source.symbolType },
        startLine: source.startLine, endLine: source.endLine,
        relationship: { id: edge.id, type: edge.type as RelationshipType,
            sourceSymbol: { id: source.id, name: source.name, type: source.symbolType, fileId: source.fileId, filePath: source.filePath, startLine: source.startLine, endLine: source.endLine },
            targetSymbol: { id: target.id, name: target.name, type: target.symbolType, fileId: target.fileId, filePath: target.filePath, startLine: target.startLine, endLine: target.endLine } } };
}

function safeSemanticError(message: string): string {
    const status = message.match(/HTTP\s+(\d{3})/i)?.[1];
    return status ? `Semantic retrieval is unavailable (upstream HTTP ${status}).` : "Semantic retrieval is unavailable.";
}
