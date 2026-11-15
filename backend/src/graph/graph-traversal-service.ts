import { GraphRepository } from "./graph-repository.js";
import type { GraphPathResult, GraphRelationship, GraphSymbol, ImpactAffectedFile, ImpactAffectedSymbol, ImpactAnalysisResult, ImpactCategory, ImpactEvidence, ImpactEvidencePath, ImpactPathEvidence, PathStep, RelationshipType, TraversalDirection, TraversalHit, TraversalResult } from "./types.js";

const MAX_IMPACT_EVIDENCE_PATHS = 5;
const MAX_SHORTEST_PATHS = 5;

export interface ImpactResourceLimits {
    maxProcessedEdges: number;
    maxResults: number;
}

export const DEFAULT_IMPACT_RESOURCE_LIMITS: Readonly<ImpactResourceLimits> = Object.freeze({
    maxProcessedEdges: 10000,
    maxResults: 1000
});

export class GraphAnalysisError extends Error {
    constructor(readonly code: "REPOSITORY_NOT_FOUND" | "SYMBOL_NOT_FOUND", message: string) {
        super(message);
    }
}

interface ShortestPathState {
    current: GraphSymbol;
    steps: PathStep[];
    visited: Set<string>;
}

function compareOutgoingRelationships(a: GraphRelationship, b: GraphRelationship): number {
    return compareSymbols(a.target, b.target) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id);
}

function compareShortestPathStates(a: ShortestPathState, b: ShortestPathState): number {
    return compareSymbols(a.current, b.current) || compareStepPaths(a.steps, b.steps);
}

function compareStepPaths(a: PathStep[], b: PathStep[]): number {
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const symbolOrder = compareSymbols(a[index].symbol, b[index].symbol);
        if (symbolOrder !== 0) return symbolOrder;
        const aEdge = a[index].relationshipFromPrevious;
        const bEdge = b[index].relationshipFromPrevious;
        const edgeOrder = (aEdge?.type ?? "").localeCompare(bEdge?.type ?? "") || (aEdge?.id ?? "").localeCompare(bEdge?.id ?? "");
        if (edgeOrder !== 0) return edgeOrder;
    }
    return a.length - b.length;
}

function pathKey(steps: PathStep[]): string {
    return steps.map(step => `${step.symbol.id}:${step.relationshipFromPrevious?.id ?? "start"}`).join("/");
}
interface ImpactPathState {
    current: GraphSymbol;
    symbols: GraphSymbol[];
    relationships: GraphRelationship[];
    visited: Set<string>;
}
interface CollectedImpactPaths {
    symbol: GraphSymbol;
    minDepth: number;
    paths: ImpactEvidencePath[];
    pathKeys: Set<string>;
    additionalPathsOmitted: boolean;
}
interface ImpactWalkResult {
    results: ImpactEvidence[];
}
interface ImpactTraversalBudget {
    remainingEdges: number;
    resultKeys: Set<string>;
    traversalTruncated: boolean;
    evidencePathsTruncated: boolean;
    resultsTruncated: boolean;
    stopped: boolean;
}

export class GraphTraversalService {
    constructor(private readonly repository: GraphRepository,
        private readonly impactLimits: ImpactResourceLimits = DEFAULT_IMPACT_RESOURCE_LIMITS) {
        if (!Number.isInteger(impactLimits.maxProcessedEdges) || impactLimits.maxProcessedEdges < 1 ||
            impactLimits.maxProcessedEdges > DEFAULT_IMPACT_RESOURCE_LIMITS.maxProcessedEdges ||
            !Number.isInteger(impactLimits.maxResults) || impactLimits.maxResults < 1 ||
            impactLimits.maxResults > DEFAULT_IMPACT_RESOURCE_LIMITS.maxResults) {
            throw new RangeError("Impact resource limits must be positive integers within the configured maximums.");
        }
    }

    async trace(repositoryId: string, symbolId: string, direction: "INCOMING" | "OUTGOING", maxDepth: number,
        relationshipTypes: RelationshipType[]): Promise<TraversalResult> {
        const target = await this.requireSymbol(repositoryId, symbolId);
        const results = await this.walk(repositoryId, target, direction, maxDepth, relationshipTypes);
        return { repositoryId, direction, target, maxDepth, relationshipTypes: [...relationshipTypes].sort(), results };
    }

    async shortestPath(repositoryId: string, fromSymbolId: string, toSymbolId: string, maxDepth: number,
        relationshipTypes: RelationshipType[]): Promise<GraphPathResult> {
        const [from, to] = await Promise.all([
            this.requireSymbol(repositoryId, fromSymbolId),
            this.requireSymbol(repositoryId, toSymbolId)
        ]);
        const sortedTypes = [...relationshipTypes].sort();
        const edgeLimit = this.impactLimits.maxProcessedEdges;
        const emptyResult = (traversalTruncated = false): GraphPathResult => ({ repositoryId, found: false, maxDepth,
            relationshipTypes: sortedTypes, steps: [], paths: [], edgeProcessingLimit: edgeLimit,
            traversalTruncated, alternativePathsTruncated: false, pathsTruncated: traversalTruncated });
        if (from.id === to.id) {
            const onlyStep: PathStep[] = [{ symbol: from, depth: 0, relationshipFromPrevious: null }];
            return { ...emptyResult(), found: true, steps: onlyStep, paths: [onlyStep] };
        }

        // One budget covers every examined edge/path-state pair. Each SQL result is
        // capped at remaining + 1 (one sentinel), and each returned edge is related
        // to at least one current state, so total materialized adjacency is bounded
        // by the same budget plus the single truncation sentinel.
        let remainingEdges = edgeLimit;
        let traversalTruncated = false;
        let alternativePathsTruncated = false;
        let frontier: ShortestPathState[] = [{ current: from,
            steps: [{ symbol: from, depth: 0, relationshipFromPrevious: null }], visited: new Set([from.id]) }];
        let shortestPaths: PathStep[][] = [];

        for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
            frontier.sort(compareShortestPathStates);
            const bounded = await this.repository.getAdjacentRelationshipsBounded(repositoryId,
                [...new Set(frontier.map(state => state.current.id))], "OUTGOING", relationshipTypes, remainingEdges);
            if (bounded.hasMore) traversalTruncated = true;

            const edgesBySource = new Map<string, GraphRelationship[]>();
            for (const edge of bounded.relationships) {
                const adjacent = edgesBySource.get(edge.source.id) ?? [];
                adjacent.push(edge);
                edgesBySource.set(edge.source.id, adjacent);
            }
            for (const adjacent of edgesBySource.values()) adjacent.sort(compareOutgoingRelationships);

            const next: ShortestPathState[] = [];
            const pathKeys = new Set<string>();
            candidateLoop: for (const state of frontier) {
                for (const edge of edgesBySource.get(state.current.id) ?? []) {
                    if (remainingEdges === 0) {
                        traversalTruncated = true;
                        break candidateLoop;
                    }
                    remainingEdges -= 1;
                    if (state.visited.has(edge.target.id)) continue;
                    const step: PathStep = { symbol: edge.target, depth,
                        relationshipFromPrevious: { id: edge.id, type: edge.type,
                            fromSymbolId: edge.source.id, toSymbolId: edge.target.id } };
                    const steps = [...state.steps, step];
                    if (edge.target.id === to.id) {
                        const key = pathKey(steps);
                        if (!pathKeys.has(key)) {
                            pathKeys.add(key);
                            if (shortestPaths.length < MAX_SHORTEST_PATHS) shortestPaths.push(steps);
                            else alternativePathsTruncated = true;
                        }
                        continue;
                    }
                    const visited = new Set(state.visited);
                    visited.add(edge.target.id);
                    next.push({ current: edge.target, steps, visited });
                }
            }
            // Every path in `frontier` is at the same depth. Finish this level to collect
            // equal-length alternatives, but never expand a deeper level after a hit.
            if (shortestPaths.length > 0 || bounded.hasMore || traversalTruncated) break;
            frontier = next;
        }

        shortestPaths.sort(compareStepPaths);
        const firstPath = shortestPaths[0] ?? [];
        return { repositoryId, found: firstPath.length > 0, maxDepth, relationshipTypes: sortedTypes,
            steps: firstPath, paths: shortestPaths, edgeProcessingLimit: edgeLimit, traversalTruncated,
            alternativePathsTruncated, pathsTruncated: traversalTruncated || alternativePathsTruncated };
    }

    async impact(repositoryId: string, symbolId: string, maxDepth: number): Promise<ImpactAnalysisResult> {
        const target = await this.requireSymbol(repositoryId, symbolId);
        const budget: ImpactTraversalBudget = { remainingEdges: this.impactLimits.maxProcessedEdges, resultKeys: new Set(),
            traversalTruncated: false, evidencePathsTruncated: false, resultsTruncated: false, stopped: false };
        const callers = await this.walkImpactPaths(repositoryId, target, maxDepth, ["CALLS"], "caller", budget);
        const importers = await this.walkImpactPaths(repositoryId, target, 1, ["IMPORTS"], "importer", budget);
        const implementors = await this.walkImpactPaths(repositoryId, target, 1, ["IMPLEMENTS"], "implementor", budget);
        const subclasses = await this.walkImpactPaths(repositoryId, target, 1, ["EXTENDS"], "subclass", budget);
        const implementations = mergeImplementationEvidence(implementors.results, subclasses.results);
        const groups = [callers.results, importers.results, implementors.results, subclasses.results];
        const affectedSymbols = buildAffectedSymbols(groups);
        const affectedFiles = buildAffectedFiles(affectedSymbols);
        return {
            repositoryId,
            target,
            maxDepth,
            callers: callers.results,
            importers: importers.results,
            implementations,
            implementors: implementors.results,
            subclasses: subclasses.results,
            affectedSymbols,
            affectedFiles,
            edgeProcessingLimit: this.impactLimits.maxProcessedEdges,
            resultLimit: this.impactLimits.maxResults,
            evidencePathLimit: MAX_IMPACT_EVIDENCE_PATHS,
            traversalTruncated: budget.traversalTruncated,
            evidencePathsTruncated: budget.evidencePathsTruncated,
            resultsTruncated: budget.resultsTruncated,
            pathsTruncated: budget.traversalTruncated || budget.evidencePathsTruncated || budget.resultsTruncated,
            interpretation: "Graph-derived dependencies only; static relationships do not guarantee runtime execution or capture every semantic effect of a change. Import evidence identifies a dependent file and does not prove that a particular symbol uses the imported symbol. If any truncation flag is true, the returned groups may omit affected symbols or evidence paths."
        };
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

    private async walkImpactPaths(repositoryId: string, target: GraphSymbol, maxDepth: number,
        relationshipTypes: RelationshipType[], category: ImpactCategory, budget: ImpactTraversalBudget): Promise<ImpactWalkResult> {
        const records = new Map<string, CollectedImpactPaths>();
        if (budget.stopped) return { results: [] };
        let frontier: ImpactPathState[] = [{ current: target, symbols: [target], relationships: [], visited: new Set([target.id]) }];

        for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
            frontier.sort(compareImpactPathStates);
            const currentIds = [...new Set(frontier.map(state => state.current.id))];
            const bounded = await this.repository.getAdjacentRelationshipsBounded(repositoryId, currentIds, "INCOMING", relationshipTypes, budget.remainingEdges);
            if (bounded.hasMore) budget.traversalTruncated = true;
            const edgesByTarget = new Map<string, GraphRelationship[]>();
            for (const edge of bounded.relationships) {
                const adjacent = edgesByTarget.get(edge.target.id) ?? [];
                adjacent.push(edge);
                edgesByTarget.set(edge.target.id, adjacent);
            }

            const next: ImpactPathState[] = [];
            candidateLoop: for (const state of frontier) {
                for (const edge of edgesByTarget.get(state.current.id) ?? []) {
                    if (budget.remainingEdges === 0) {
                        budget.traversalTruncated = true;
                        budget.stopped = true;
                        break candidateLoop;
                    }
                    budget.remainingEdges -= 1;
                    const affected = edge.source;
                    if (state.visited.has(affected.id)) continue;

                    const symbols = [...state.symbols, affected];
                    const relationships = [...state.relationships, edge];
                    const key = relationships.map(item => item.id).join("/");
                    let record = records.get(affected.id);
                    if (!record && !budget.resultKeys.has(`${category}:${affected.id}`)) {
                        if (budget.resultKeys.size >= this.impactLimits.maxResults) {
                            budget.resultsTruncated = true;
                            budget.traversalTruncated = true;
                            budget.stopped = true;
                            break candidateLoop;
                        }
                        budget.resultKeys.add(`${category}:${affected.id}`);
                    }
                    record ??= {
                        symbol: affected,
                        minDepth: depth,
                        paths: [],
                        pathKeys: new Set<string>(),
                        additionalPathsOmitted: false
                    };
                    if (record.pathKeys.has(key)) continue;
                    record.minDepth = Math.min(record.minDepth, depth);
                    if (record.paths.length >= MAX_IMPACT_EVIDENCE_PATHS) {
                        record.additionalPathsOmitted = true;
                        budget.evidencePathsTruncated = true;
                        budget.traversalTruncated = true;
                        records.set(affected.id, record);
                        continue;
                    }

                    const evidencePath: ImpactEvidencePath = { direction: "INCOMING", symbols, relationships };
                    record.pathKeys.add(key);
                    record.paths.push(evidencePath);
                    records.set(affected.id, record);
                    const visited = new Set(state.visited);
                    visited.add(affected.id);
                    next.push({ current: affected, symbols, relationships, visited });
                }
            }
            if (bounded.hasMore) budget.stopped = true;
            if (budget.stopped) break;
            frontier = next;
        }

        return { results: [...records.values()].map(record => impactEvidence(record, category))
            .sort((a, b) => a.minDepth - b.minDepth || compareSymbols(a.symbol, b.symbol) || a.category.localeCompare(b.category)) };
    }
}

function compareSymbols(a: GraphSymbol, b: GraphSymbol): number {
    return a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function compareImpactPathStates(a: ImpactPathState, b: ImpactPathState): number {
    return compareSymbols(a.current, b.current) || compareImpactEvidencePaths(
        { direction: "INCOMING", symbols: a.symbols, relationships: a.relationships },
        { direction: "INCOMING", symbols: b.symbols, relationships: b.relationships }
    );
}

function compareImpactEvidencePaths(a: ImpactEvidencePath, b: ImpactEvidencePath): number {
    return a.relationships.length - b.relationships.length ||
        compareSymbolPaths(a.symbols, b.symbols) ||
        compareRelationshipPaths(a.relationships, b.relationships);
}

function compareSymbolPaths(a: GraphSymbol[], b: GraphSymbol[]): number {
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const comparison = compareSymbols(a[index], b[index]);
        if (comparison !== 0) return comparison;
    }
    return a.length - b.length;
}

function compareRelationshipPaths(a: GraphRelationship[], b: GraphRelationship[]): number {
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const comparison = a[index].type.localeCompare(b[index].type) || a[index].id.localeCompare(b[index].id);
        if (comparison !== 0) return comparison;
    }
    return a.length - b.length;
}

function impactEvidence(record: CollectedImpactPaths, category: ImpactCategory): ImpactEvidence {
    const evidencePaths: ImpactPathEvidence[] = [...record.paths].sort(compareImpactEvidencePaths)
        .map(path => ({ ...path, category }));
    const terminalRelationship = evidencePaths[0]?.relationships.at(-1);
    if (!terminalRelationship) throw new Error("Impact evidence path is missing its terminal relationship.");
    const symbol = record.symbol;
    const minDepth = record.minDepth;
    return {
        symbolId: symbol.id,
        name: symbol.name,
        type: symbol.type,
        fileId: symbol.fileId,
        filePath: symbol.filePath,
        language: symbol.language,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        parentSymbolId: symbol.parentSymbolId,
        parentSymbolName: symbol.parentSymbolName,
        depth: minDepth,
        direct: minDepth === 1,
        relationshipType: terminalRelationship.type,
        relationshipId: terminalRelationship.id,
        category,
        evidenceScope: category === "importer" ? "FILE" : "SYMBOL",
        classification: minDepth === 1 ? "direct" : "indirect",
        minDepth,
        symbol,
        file: { id: symbol.fileId, path: symbol.filePath, language: symbol.language },
        evidencePaths,
        additionalPathsOmitted: record.additionalPathsOmitted
    };
}

function mergeImplementationEvidence(implementors: ImpactEvidence[], subclasses: ImpactEvidence[]): ImpactEvidence[] {
    const merged = new Map<string, ImpactEvidence>();
    const legacyTypeOrder: Record<ImpactCategory, number> = { subclass: 0, implementor: 1, caller: 2, importer: 3 };
    for (const evidence of [...implementors, ...subclasses].sort((a, b) => compareSymbols(a.symbol, b.symbol) ||
        legacyTypeOrder[a.category] - legacyTypeOrder[b.category] || a.relationshipId.localeCompare(b.relationshipId))) {
        const current = merged.get(evidence.symbolId);
        if (!current) {
            merged.set(evidence.symbolId, { ...evidence, evidencePaths: [...evidence.evidencePaths] });
            continue;
        }
        const paths = new Map(current.evidencePaths.map(path => [path.relationships.map(edge => edge.id).join("/"), path]));
        for (const path of evidence.evidencePaths) paths.set(path.relationships.map(edge => edge.id).join("/"), path);
        current.evidencePaths = [...paths.values()].sort(compareImpactEvidencePaths);
        current.additionalPathsOmitted ||= evidence.additionalPathsOmitted;
    }
    return [...merged.values()].sort((a, b) => a.minDepth - b.minDepth || compareSymbols(a.symbol, b.symbol));
}

function buildAffectedSymbols(groups: ImpactEvidence[][]): ImpactAffectedSymbol[] {
    const affected = new Map<string, ImpactAffectedSymbol>();
    for (const evidence of groups.flat()) {
        const current = affected.get(evidence.symbolId) ?? {
            symbol: evidence.symbol,
            file: evidence.file,
            categories: [],
            evidenceScopes: [],
            classification: evidence.classification,
            minDepth: evidence.minDepth,
            evidencePaths: [],
            additionalPathsOmitted: false
        };
        current.minDepth = Math.min(current.minDepth, evidence.minDepth);
        current.classification = current.minDepth === 1 ? "direct" : "indirect";
        if (!current.categories.includes(evidence.category)) current.categories.push(evidence.category);
        if (!current.evidenceScopes.includes(evidence.evidenceScope)) current.evidenceScopes.push(evidence.evidenceScope);
        for (const path of evidence.evidencePaths) current.evidencePaths.push(path);
        current.additionalPathsOmitted ||= evidence.additionalPathsOmitted;
        affected.set(evidence.symbolId, current);
    }

    return [...affected.values()].map(item => ({
        ...item,
        categories: item.categories.sort(),
        evidenceScopes: item.evidenceScopes.sort(),
        evidencePaths: [...item.evidencePaths].sort((a, b) => a.relationships.length - b.relationships.length ||
            a.category.localeCompare(b.category) || compareImpactEvidencePaths(a, b))
    })).sort((a, b) => a.minDepth - b.minDepth || compareSymbols(a.symbol, b.symbol));
}

function buildAffectedFiles(affectedSymbols: ImpactAffectedSymbol[]): ImpactAffectedFile[] {
    const files = new Map<string, { fileId: string; path: string; language: string | null; minDepth: number; relationshipTypes: Set<RelationshipType>; symbols: Map<string, string> }>();
    for (const evidence of affectedSymbols) {
        const file = files.get(evidence.file.id) ?? {
            fileId: evidence.file.id,
            path: evidence.file.path,
            language: evidence.file.language,
            minDepth: evidence.minDepth,
            relationshipTypes: new Set<RelationshipType>(),
            symbols: new Map<string, string>()
        };
        file.minDepth = Math.min(file.minDepth, evidence.minDepth);
        file.symbols.set(evidence.symbol.id, evidence.symbol.name);
        for (const path of evidence.evidencePaths) {
            const terminalRelationship = path.relationships.at(-1);
            if (terminalRelationship) file.relationshipTypes.add(terminalRelationship.type);
        }
        files.set(evidence.file.id, file);
    }
    return [...files.values()].map(file => ({
        fileId: file.fileId,
        path: file.path,
        language: file.language,
        minDepth: file.minDepth,
        relationshipTypes: [...file.relationshipTypes].sort(),
        symbols: [...file.symbols].map(([symbolId, name]) => ({ symbolId, name }))
            .sort((a, b) => a.name.localeCompare(b.name) || a.symbolId.localeCompare(b.symbolId))
    })).sort((a, b) => a.minDepth - b.minDepth || a.path.localeCompare(b.path) || a.fileId.localeCompare(b.fileId));
}
