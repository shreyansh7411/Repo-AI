import { GraphRepository } from "./graph-repository.js";
import type { GraphRelationship, GraphSymbol, PathStep, RelationshipType, TraversalDirection, TraversalHit, TraversalResult } from "./types.js";

export class GraphAnalysisError extends Error {
    constructor(readonly code: "REPOSITORY_NOT_FOUND" | "SYMBOL_NOT_FOUND", message: string) {
        super(message);
    }
}

interface PreviousStep { previousId: string; edge: GraphRelationship }

export class GraphTraversalService {
    constructor(private readonly repository: GraphRepository) {}

    async trace(repositoryId: string, symbolId: string, direction: "INCOMING" | "OUTGOING", maxDepth: number,
        relationshipTypes: RelationshipType[]): Promise<TraversalResult> {
        const target = await this.requireSymbol(repositoryId, symbolId);
        const results = await this.walk(repositoryId, target, direction, maxDepth, relationshipTypes);
        return { repositoryId, direction, target, maxDepth, relationshipTypes: [...relationshipTypes].sort(), results };
    }

    async shortestPath(repositoryId: string, fromSymbolId: string, toSymbolId: string, maxDepth: number,
        relationshipTypes: RelationshipType[]): Promise<{ repositoryId: string; found: boolean; maxDepth: number; relationshipTypes: RelationshipType[]; steps: PathStep[] }> {
        const [from, to] = await Promise.all([
            this.requireSymbol(repositoryId, fromSymbolId),
            this.requireSymbol(repositoryId, toSymbolId)
        ]);
        if (from.id === to.id) return { repositoryId, found: true, maxDepth, relationshipTypes: [...relationshipTypes].sort(),
            steps: [{ symbol: from, depth: 0, relationshipFromPrevious: null }] };

        const visited = new Set([from.id]);
        const previous = new Map<string, PreviousStep>();
        let frontier = [from];
        let found = false;
        for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
            const relationships = await this.repository.getAdjacentRelationships(repositoryId, frontier.map(symbol => symbol.id), "OUTGOING", relationshipTypes);
            const candidates = relationships.map(edge => ({ edge, symbol: edge.target }))
                .sort((a, b) => compareSymbols(a.symbol, b.symbol) || a.edge.type.localeCompare(b.edge.type) || a.edge.id.localeCompare(b.edge.id));
            const next: GraphSymbol[] = [];
            for (const candidate of candidates) {
                if (visited.has(candidate.symbol.id)) continue;
                visited.add(candidate.symbol.id);
                previous.set(candidate.symbol.id, { previousId: candidate.edge.source.id, edge: candidate.edge });
                next.push(candidate.symbol);
                if (candidate.symbol.id === to.id) found = true;
            }
            if (found) break;
            frontier = next;
        }
        if (!found) return { repositoryId, found: false, maxDepth, relationshipTypes: [...relationshipTypes].sort(), steps: [] };
        const reverseSymbols: GraphSymbol[] = [to];
        const reverseEdges: GraphRelationship[] = [];
        let current = to.id;
        while (current !== from.id) {
            const step = previous.get(current);
            if (!step) return { repositoryId, found: false, maxDepth, relationshipTypes: [...relationshipTypes].sort(), steps: [] };
            reverseEdges.push(step.edge);
            reverseSymbols.push(step.edge.source);
            current = step.previousId;
        }
        reverseSymbols.reverse();
        reverseEdges.reverse();
        const steps: PathStep[] = reverseSymbols.map((symbol, index) => {
            const edge = reverseEdges[index - 1];
            return { symbol, depth: index, relationshipFromPrevious: edge ? { id: edge.id, type: edge.type,
                fromSymbolId: edge.source.id, toSymbolId: edge.target.id } : null };
        });
        return { repositoryId, found: true, maxDepth, relationshipTypes: [...relationshipTypes].sort(), steps };
    }

    async impact(repositoryId: string, symbolId: string, maxDepth: number) {
        const target = await this.requireSymbol(repositoryId, symbolId);
        const [callers, importers, implementations] = await Promise.all([
            this.walk(repositoryId, target, "INCOMING", maxDepth, ["CALLS"]),
            this.walk(repositoryId, target, "INCOMING", 1, ["IMPORTS"]),
            this.walk(repositoryId, target, "INCOMING", 1, ["IMPLEMENTS", "EXTENDS"])
        ]);
        const affected = new Map<string, { fileId: string; path: string; language: string | null; minDepth: number; relationshipTypes: Set<RelationshipType>; symbols: Map<string, string> }>();
        for (const hit of [...callers, ...importers, ...implementations]) {
            const symbol = hit.symbol;
            const file = affected.get(symbol.fileId) ?? { fileId: symbol.fileId, path: symbol.filePath,
                language: symbol.language, minDepth: hit.depth, relationshipTypes: new Set<RelationshipType>(), symbols: new Map<string, string>() };
            file.minDepth = Math.min(file.minDepth, hit.depth);
            file.relationshipTypes.add(hit.relationship.type);
            file.symbols.set(symbol.id, symbol.name);
            affected.set(symbol.fileId, file);
        }
        const affectedFiles = [...affected.values()].map(file => ({ fileId: file.fileId, path: file.path, language: file.language,
            minDepth: file.minDepth, relationshipTypes: [...file.relationshipTypes].sort(),
            symbols: [...file.symbols].map(([id, name]) => ({ symbolId: id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.symbolId.localeCompare(b.symbolId)) }))
            .sort((a, b) => a.minDepth - b.minDepth || a.path.localeCompare(b.path) || a.fileId.localeCompare(b.fileId));
        return { repositoryId, target, maxDepth,
            callers: callers.map(hit => impactHit(hit)),
            importers: importers.map(hit => impactHit(hit)),
            implementations: implementations.map(hit => impactHit(hit)),
            affectedFiles,
            interpretation: "Graph-derived dependencies only; this is not a guarantee that every semantic or runtime effect of a change has been detected." };
    }

    private async requireSymbol(repositoryId: string, symbolId: string): Promise<GraphSymbol> {
        const symbol = await this.repository.getSymbol(repositoryId, symbolId);
        if (!symbol) throw new GraphAnalysisError("SYMBOL_NOT_FOUND", "Symbol was not found in this repository.");
        return symbol;
    }

    private async walk(repositoryId: string, start: GraphSymbol, direction: TraversalDirection,
        maxDepth: number, relationshipTypes: RelationshipType[]): Promise<TraversalHit[]> {
        const visited = new Set([start.id]);
        let frontier = [start];
        const hits: TraversalHit[] = [];
        for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
            const edges = await this.repository.getAdjacentRelationships(repositoryId, frontier.map(symbol => symbol.id), direction, relationshipTypes);
            const candidates = edges.map(edge => ({ edge, symbol: direction === "INCOMING" ? edge.source : edge.target }));
            candidates.sort((a, b) => compareSymbols(a.symbol, b.symbol) || a.edge.type.localeCompare(b.edge.type) || a.edge.id.localeCompare(b.edge.id));
            const next: GraphSymbol[] = [];
            for (const { edge, symbol } of candidates) {
                if (visited.has(symbol.id)) continue;
                visited.add(symbol.id);
                next.push(symbol);
                hits.push({ symbol, depth, direct: depth === 1,
                    relationship: { id: edge.id, type: edge.type, fromSymbolId: edge.source.id, toSymbolId: edge.target.id } });
            }
            frontier = next;
        }
        return hits.sort((a, b) => a.depth - b.depth || compareSymbols(a.symbol, b.symbol) || a.relationship.type.localeCompare(b.relationship.type) || a.relationship.id.localeCompare(b.relationship.id));
    }
}

function compareSymbols(a: GraphSymbol, b: GraphSymbol): number {
    return a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function impactHit(hit: TraversalHit) {
    return { symbolId: hit.symbol.id, name: hit.symbol.name, type: hit.symbol.type, fileId: hit.symbol.fileId,
        filePath: hit.symbol.filePath, language: hit.symbol.language, startLine: hit.symbol.startLine, endLine: hit.symbol.endLine,
        parentSymbolId: hit.symbol.parentSymbolId, parentSymbolName: hit.symbol.parentSymbolName,
        depth: hit.depth, direct: hit.direct, relationshipType: hit.relationship.type, relationshipId: hit.relationship.id };
}
