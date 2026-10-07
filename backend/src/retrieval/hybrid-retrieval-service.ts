import type { CodeChunkEmbeddingRepository } from "../embeddings/code-chunk-embedding-repository.js";
import type { EmbeddingService } from "../embeddings/embedding-service.js";
import { StructuralRetrievalRepository } from "./structural-retrieval-repository.js";
import type { Evidence, RetrievalResult, StructuralRelationship, StructuralSymbol } from "./types.js";

export interface RetrievalOptions { topK?: number; maxDepth?: number; maxContextChars?: number }

export class HybridRetrievalService {
    constructor(
        private readonly semanticRepository: CodeChunkEmbeddingRepository,
        private readonly embeddingService: Pick<EmbeddingService, "embedQuery">,
        private readonly structuralRepository: StructuralRetrievalRepository,
        private readonly defaultContextChars = Number(process.env.MAX_CONTEXT_CHARS) || 24_000
    ) {}

    async retrieve(repositoryId: string, query: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
        const topK = options.topK ?? 6;
        const maxDepth = options.maxDepth ?? 1;
        const maxContextChars = options.maxContextChars ?? this.defaultContextChars;
        if (!Number.isInteger(topK) || topK < 1 || topK > 20) throw new Error("topK must be an integer between 1 and 20.");
        if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 2) throw new Error("maxDepth must be an integer between 0 and 2.");
        if (!Number.isInteger(maxContextChars) || maxContextChars < 1000 || maxContextChars > 100_000) throw new Error("maxContextChars must be between 1000 and 100000.");

        let semantic: Awaited<ReturnType<CodeChunkEmbeddingRepository["search"]>> = [];
        let semanticError: string | undefined;
        let vector: number[] | undefined;
        try {
            vector = await this.embeddingService.embedQuery(query);
        } catch (error) {
            semanticError = error instanceof Error ? error.message : "Semantic query embedding failed.";
        }
        if (vector) semantic = await this.semanticRepository.search(repositoryId, vector, topK);
        const nameMatches = await this.structuralRepository.findMatchingSymbols(repositoryId, query);
        const seedIds = [...new Set([...semantic.flatMap(row => row.symbolId ? [row.symbolId] : []), ...nameMatches.map(row => row.id)])];
        const graph = await this.structuralRepository.expand(repositoryId, seedIds, maxDepth);
        const symbols = mergeSymbols(nameMatches, graph.symbols);
        const relationships = graph.relationships;
        const structuralChunks = await this.structuralRepository.getSymbolChunks(repositoryId, symbols.map(symbol => symbol.id));
        const evidence = combineEvidence(repositoryId, semantic, structuralChunks, relationships, nameMatches);
        evidence.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
        const selected: Evidence[] = [];
        let context = "";
        for (const item of evidence) {
            const block = formatEvidence(item);
            if (context.length + block.length + (context ? 2 : 0) > maxContextChars) continue;
            selected.push(item);
            context += `${context ? "\n\n" : ""}${block}`;
        }
        const selectedIds = new Set(selected.map(item => item.id));
        const selectedRelationships = relationships.filter(edge => selectedIds.has(`relationship:${edge.id}`));
        const selectedSymbols = symbols.filter(symbol => selected.some(item => item.symbolId === symbol.id) || selectedRelationships.some(edge => edge.source.id === symbol.id || edge.target.id === symbol.id));
        return { repositoryId, query, semantic, ...(semanticError ? { semanticError } : {}), symbols: selectedSymbols, relationships: selectedRelationships,
            evidence: selected, context, contextChars: context.length, truncated: selected.length < evidence.length };
    }
}

function mergeSymbols(...groups: StructuralSymbol[][]): StructuralSymbol[] {
    const byId = new Map<string, StructuralSymbol>();
    for (const group of groups) for (const symbol of group) byId.set(symbol.id, symbol);
    return [...byId.values()];
}

function combineEvidence(repositoryId: string, semantic: Awaited<ReturnType<CodeChunkEmbeddingRepository["search"]>>, structuralChunks: Array<Record<string, unknown>>, relationships: StructuralRelationship[], nameMatches: StructuralSymbol[]): Evidence[] {
    const byId = new Map<string, Evidence>();
    for (const chunk of semantic) byId.set(`chunk:${chunk.id}`, {
        id: `chunk:${chunk.id}`, kind: "CHUNK", provenance: "SEMANTIC", repositoryId,
        filePath: chunk.filePath, symbolId: chunk.symbolId, symbol: chunk.symbolName, symbolType: chunk.symbolType,
        startLine: chunk.startLine, endLine: chunk.endLine, content: chunk.content,
        similarity: Number(chunk.similarity), score: 1 + Math.max(0, Number(chunk.similarity))
    });
    const matched = new Set(nameMatches.map(symbol => symbol.id));
    for (const row of structuralChunks) {
        const id = String(row.id), evidenceId = `chunk:${id}`;
        const previous = byId.get(evidenceId);
        if (previous) { previous.provenance = "BOTH"; previous.score += 0.35; continue; }
        byId.set(evidenceId, {
            id: evidenceId, kind: "CHUNK", provenance: "STRUCTURAL", repositoryId,
            filePath: String(row.filePath), symbolId: row.symbolId ? String(row.symbolId) : null,
            symbol: row.symbolName ? String(row.symbolName) : null, symbolType: row.symbolType ? String(row.symbolType) : null,
            startLine: Number(row.startLine), endLine: Number(row.endLine), content: String(row.content),
            score: row.symbolId && matched.has(String(row.symbolId)) ? 0.8 : 0.55
        });
    }
    for (const edge of relationships) {
        byId.set(`relationship:${edge.id}`, relationshipEvidence(repositoryId, edge, matched));
    }
    return [...byId.values()];
}

function relationshipEvidence(repositoryId: string, edge: StructuralRelationship, matched: Set<string>): Evidence {
    const source = edge.source, target = edge.target;
    return { id: `relationship:${edge.id}`, kind: "RELATIONSHIP", provenance: "STRUCTURAL", repositoryId,
        filePath: source.filePath, symbolId: source.id, symbol: source.name, symbolType: source.symbolType,
        startLine: source.startLine, endLine: source.endLine,
        content: `${source.name} --${edge.type}--> ${target.name}`,
        relationship: { id: edge.id, type: edge.type, source: source.name, target: target.name },
        score: 0.6 + (matched.has(source.id) || matched.has(target.id) ? 0.25 : 0) };
}

function formatEvidence(item: Evidence): string {
    const location = `${item.filePath}:${item.startLine}-${item.endLine}`;
    const symbol = item.symbol ? ` | ${item.symbol}${item.symbolType ? ` (${item.symbolType})` : ""}` : "";
    const similarity = item.similarity === undefined ? "" : ` | similarity=${item.similarity.toFixed(4)}`;
    return `[${item.id}] ${item.kind} ${item.provenance} | ${location}${symbol}${similarity}\n${item.content}`;
}
