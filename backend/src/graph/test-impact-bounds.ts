import assert from "node:assert/strict";
import { GraphRepository } from "./graph-repository.js";
import { DEFAULT_IMPACT_RESOURCE_LIMITS, GraphTraversalService } from "./graph-traversal-service.js";
import type { GraphRelationship, GraphSymbol, RelationshipType } from "./types.js";

const repositoryId = "repo-a";
const foreignRepositoryId = "repo-b";

interface OwnedSymbol { repositoryId: string; symbol: GraphSymbol }
interface OwnedRelationship { repositoryId: string; relationship: GraphRelationship }

class SyntheticGraphRepository {
    readonly adjacencyBudgets: number[] = [];
    readonly adjacencyTypes: RelationshipType[][] = [];
    readonly adjacencyDirections: Array<"INCOMING" | "OUTGOING"> = [];

    constructor(private readonly symbols: OwnedSymbol[], private readonly edges: OwnedRelationship[]) {}

    async getSymbol(ownerId: string, symbolId: string): Promise<GraphSymbol | null> {
        return this.symbols.find(item => item.repositoryId === ownerId && item.symbol.id === symbolId)?.symbol ?? null;
    }

    async getAdjacentRelationshipsBounded(ownerId: string, ids: string[], direction: "INCOMING" | "OUTGOING", types: RelationshipType[], remaining: number) {
        this.adjacencyBudgets.push(remaining);
        this.adjacencyTypes.push([...types]);
        this.adjacencyDirections.push(direction);
        const matches = this.edges.filter(item => item.repositoryId === ownerId && types.includes(item.relationship.type) &&
            (direction === "INCOMING" ? ids.includes(item.relationship.target.id) : ids.includes(item.relationship.source.id)))
            .map(item => item.relationship)
            .sort((a, b) => a.type.localeCompare(b.type) || a.source.filePath.localeCompare(b.source.filePath) ||
                a.source.startLine - b.source.startLine || a.source.name.localeCompare(b.source.name) || a.source.id.localeCompare(b.source.id) || a.id.localeCompare(b.id));
        return { relationships: matches.slice(0, remaining), hasMore: matches.length > remaining };
    }
}

function symbol(id: string, name = id, path = `src/${id}.ts`, line = 1): GraphSymbol {
    return { id, name, type: "METHOD", fileId: `file-${path}`, filePath: path, language: "typescript",
        startLine: line, endLine: line + 1, parentSymbolId: null, parentSymbolName: null, parentSymbolType: null };
}

function edge(id: string, source: GraphSymbol, target: GraphSymbol, type: RelationshipType = "CALLS", owner = repositoryId): OwnedRelationship {
    return { repositoryId: owner, relationship: { id, source, target, type } };
}

function makeService(symbols: GraphSymbol[], edges: OwnedRelationship[], limits = DEFAULT_IMPACT_RESOURCE_LIMITS) {
    const repository = new SyntheticGraphRepository(symbols.map(item => ({ repositoryId, symbol: item })), edges);
    return { service: new GraphTraversalService(repository as unknown as GraphRepository, limits), repository };
}

async function testBoundedAdjacencyQuery() {
    const target = symbol("target");
    const callers = [symbol("caller-a"), symbol("caller-b"), symbol("caller-c")];
    const graphRows = callers.map((caller, index) => ({
        id: `edge-${index}`, type: "CALLS" as const,
        sourceId: caller.id, sourceName: caller.name, sourceType: caller.type, sourceFileId: caller.fileId,
        sourceFilePath: caller.filePath, sourceLanguage: caller.language, sourceStartLine: caller.startLine, sourceEndLine: caller.endLine,
        sourceParentId: null, sourceParentName: null, sourceParentType: null,
        targetId: target.id, targetName: target.name, targetType: target.type, targetFileId: target.fileId,
        targetFilePath: target.filePath, targetLanguage: target.language, targetStartLine: target.startLine, targetEndLine: target.endLine,
        targetParentId: null, targetParentName: null, targetParentType: null
    }));
    const queryCalls: Array<{ sql: string; values: unknown[] }> = [];
    const fakeDb = { query: async (sql: string, values: unknown[]) => {
        queryCalls.push({ sql, values });
        return { rows: graphRows.slice(0, Number(values[3])) };
    } };
    const repository = new GraphRepository(fakeDb as never);

    const result = await repository.getAdjacentRelationshipsBounded(repositoryId, [target.id], "INCOMING", ["CALLS"], 2);
    assert.equal(queryCalls[0].sql.includes("LIMIT $4"), true);
    assert.equal(queryCalls[0].values[3], 3, "SQL fetches remaining budget plus one sentinel row");
    assert.equal(result.relationships.length, 2);
    assert.equal(result.hasMore, true);

    const zeroBudgetResult = await repository.getAdjacentRelationshipsBounded(repositoryId, [target.id], "INCOMING", ["CALLS"], 0);
    assert.equal(queryCalls[1].values[3], 1, "zero remaining budget still fetches only one sentinel row");
    assert.equal(zeroBudgetResult.relationships.length, 0);
    assert.equal(zeroBudgetResult.hasMore, true);
}

async function testEdgeBudgets() {
    const target = symbol("target");
    const callers = ["a", "b", "c", "d"].map(id => symbol(id, id, `src/${id}.ts`));
    const symbols = [target, ...callers];

    const exact = makeService(symbols, callers.slice(0, 3).map((caller, index) => edge(`edge-${index}`, caller, target)),
        { maxProcessedEdges: 3, maxResults: 20 });
    const exactResult = await exact.service.impact(repositoryId, target.id, 1);
    assert.equal(exactResult.callers.length, 3);
    assert.equal(exactResult.edgeProcessingLimit, 3);
    assert.equal(exactResult.resultLimit, 20);
    assert.equal(exactResult.traversalTruncated, false, "using the exact edge budget is complete when no additional edges exist");
    assert.equal(exactResult.pathsTruncated, false);

    const over = makeService(symbols, callers.map((caller, index) => edge(`edge-${index}`, caller, target)),
        { maxProcessedEdges: 3, maxResults: 20 });
    const overResult = await over.service.impact(repositoryId, target.id, 1);
    assert.equal(overResult.callers.length, 3);
    assert.equal(overResult.traversalTruncated, true, "one edge beyond the budget is detected by the sentinel");
    assert.equal(overResult.pathsTruncated, true);
    assert.deepEqual(overResult.callers.map(item => item.filePath), ["src/a.ts", "src/b.ts", "src/c.ts"]);
    assert.deepEqual(await over.service.impact(repositoryId, target.id, 1), overResult, "budget-boundary output is deterministic");

    const importerA = symbol("importer-a");
    const importerB = symbol("importer-b");
    const sharedBudget = makeService([target, callers[0], callers[1], importerA, importerB], [
        edge("call-a", callers[0], target), edge("call-b", callers[1], target),
        edge("import-a", importerA, target, "IMPORTS"), edge("import-b", importerB, target, "IMPORTS")
    ], { maxProcessedEdges: 3, maxResults: 20 });
    const sharedResult = await sharedBudget.service.impact(repositoryId, target.id, 1);
    assert.deepEqual(sharedBudget.repository.adjacencyBudgets, [3, 1], "subsequent relationship queries receive only remaining budget");
    assert.deepEqual(sharedBudget.repository.adjacencyTypes, [["CALLS"], ["IMPORTS"]]);
    assert.equal(sharedResult.callers.length + sharedResult.importers.length, 3);
    assert.equal(sharedResult.traversalTruncated, true);
    assert.equal(sharedResult.resultsTruncated, false);

    const boundedResults = makeService(symbols, callers.map((caller, index) => edge(`result-${index}`, caller, target)),
        { maxProcessedEdges: 20, maxResults: 3 });
    const boundedResult = await boundedResults.service.impact(repositoryId, target.id, 1);
    assert.equal(boundedResult.callers.length, 3, "high fan-in response respects the result cap");
    assert.equal(boundedResult.resultsTruncated, true);
    assert.equal(boundedResult.traversalTruncated, true, "result-budget exhaustion stops further traversal");
    assert.equal(boundedResult.pathsTruncated, true);

    const exactResults = makeService(symbols, callers.slice(0, 3).map((caller, index) => edge(`exact-result-${index}`, caller, target)),
        { maxProcessedEdges: 20, maxResults: 3 });
    const exactResultLimit = await exactResults.service.impact(repositoryId, target.id, 1);
    assert.equal(exactResultLimit.callers.length, 3);
    assert.equal(exactResultLimit.resultsTruncated, false, "exactly reaching the result limit is not truncation");
}

async function testPathLimitCyclesIsolationAndLegacyOrder() {
    const target = symbol("target", "target", "src/target.ts");
    const intermediate = Array.from({ length: 6 }, (_, index) => symbol(`middle-${index}`, `middle-${index}`, `src/middle-${index}.ts`));
    const sharedCaller = symbol("shared-caller", "sharedCaller", "src/shared.ts");
    const cycleA = symbol("cycle-a", "cycleA", "src/cycle-a.ts");
    const foreignCaller = symbol("foreign-caller", "foreignCaller", "src/foreign.ts");
    const contract = symbol("contract", "contract", "src/contract.ts");
    const dualType = symbol("dual-type", "dualType", "src/dual.ts");
    const nodes = [target, ...intermediate, sharedCaller, cycleA, foreignCaller, contract, dualType];
    const edges = [
        ...intermediate.map((node, index) => edge(`to-target-${index}`, node, target)),
        ...intermediate.map((node, index) => edge(`from-shared-${index}`, sharedCaller, node)),
        edge("cycle-a-target", cycleA, target), edge("target-cycle-a", target, cycleA),
        edge("foreign-edge", foreignCaller, target, "CALLS", foreignRepositoryId),
        edge("dual-extends", dualType, contract, "EXTENDS"), edge("dual-implements", dualType, contract, "IMPLEMENTS")
    ];
    const pathService = makeService(nodes, edges, { maxProcessedEdges: 100, maxResults: 100 });
    const pathResult = await pathService.service.impact(repositoryId, target.id, 5);
    const sharedEvidence = pathResult.callers.find(item => item.symbolId === sharedCaller.id);
    assert.ok(sharedEvidence);
    assert.equal(sharedEvidence.evidencePaths.length, 5, "at most five paths are retained per symbol/category");
    assert.equal(sharedEvidence.additionalPathsOmitted, true);
    assert.equal(pathResult.evidencePathsTruncated, true);
    assert.equal(pathResult.traversalTruncated, true, "omitted paths may conceal additional downstream symbols");
    assert.equal(pathResult.callers.some(item => item.symbolId === target.id), false, "cycles never return the selected symbol as affected");
    assert.equal(pathResult.callers.some(item => item.symbolId === foreignCaller.id), false, "foreign-repository edges are excluded");
    assert.deepEqual(pathResult.callers.find(item => item.symbolId === sharedCaller.id)?.evidencePaths.map(path => path.relationships.map(rel => rel.id)),
        (await pathService.service.impact(repositoryId, target.id, 5)).callers.find(item => item.symbolId === sharedCaller.id)?.evidencePaths.map(path => path.relationships.map(rel => rel.id)));

    const legacy = await pathService.service.impact(repositoryId, contract.id, 1);
    assert.equal(legacy.implementors[0].relationshipType, "IMPLEMENTS");
    assert.equal(legacy.subclasses[0].relationshipType, "EXTENDS");
    assert.equal(legacy.implementations.length, 1);
    assert.equal(legacy.implementations[0].relationshipType, "EXTENDS", "legacy union preserves old EXTENDS-before-IMPLEMENTS selection order");
    assert.deepEqual(legacy.implementations[0].evidencePaths.map(path => path.category), ["subclass", "implementor"]);
}

async function testShortestPaths() {
    const source = symbol("path-source", "source", "src/source.ts");
    const target = symbol("path-target", "target", "src/target.ts");
    const intermediates = Array.from({ length: 6 }, (_, index) => symbol(`path-mid-${index}`, `mid${index}`, `src/mid-${index}.ts`));
    const longer = symbol("path-longer", "longer", "src/longer.ts");
    const isolated = symbol("path-isolated", "isolated", "src/isolated.ts");
    const nodes = [source, target, ...intermediates, longer, isolated];
    const edges = [
        edge("direct", source, target),
        ...intermediates.flatMap((middle, index) => [edge(`first-${index}`, source, middle), edge(`last-${index}`, middle, target)]),
        edge("longer-first", source, longer), edge("longer-last", longer, target),
        edge("cycle-back", intermediates[0], source),
        edge("reverse-edge", target, source),
        edge("import-shortcut", source, target, "IMPORTS"),
        edge("implements-shortcut", source, target, "IMPLEMENTS"),
        edge("extends-shortcut", source, target, "EXTENDS")
    ];
    const service = makeService(nodes, edges, { maxProcessedEdges: 100, maxResults: 100 });
    const direct = await service.service.shortestPath(repositoryId, source.id, target.id, 5, ["CALLS"]);
    assert.equal(direct.found, true);
    assert.equal(direct.paths.length, 1, "longer routes are not used to fill the alternative-path limit");
    assert.deepEqual(direct.steps.map(step => step.symbol.id), [source.id, target.id]);
    assert.equal(direct.steps[1].relationshipFromPrevious?.id, "direct");
    assert.equal(direct.traversalTruncated, false);
    assert.equal(direct.alternativePathsTruncated, false);

    const alternatives = makeService(nodes, edges.filter(item => item.relationship.id !== "direct" && item.relationship.id !== "longer-first" && item.relationship.id !== "longer-last"),
        { maxProcessedEdges: 100, maxResults: 100 });
    const allEqual = await alternatives.service.shortestPath(repositoryId, source.id, target.id, 2, ["CALLS"]);
    assert.equal(allEqual.paths.length, 5);
    assert.equal(allEqual.alternativePathsTruncated, true);
    assert.equal(allEqual.pathsTruncated, true);
    assert.equal(allEqual.paths.every(path => path.length === 3), true);
    assert.deepEqual(allEqual.paths.map(path => path.map(step => step.symbol.id)),
        (await alternatives.service.shortestPath(repositoryId, source.id, target.id, 2, ["CALLS"])).paths.map(path => path.map(step => step.symbol.id)),
        "equal-length alternatives use deterministic tie-breaking");
    assert.equal(allEqual.paths.some(path => path.some(step => step.symbol.id === source.id && step.depth > 0)), false,
        "cycles are excluded within each path");

    const directed = await alternatives.service.shortestPath(repositoryId, target.id, source.id, 2, ["CALLS"]);
    assert.equal(directed.found, true, "the stored target-to-source edge is followed in its stored direction");
    assert.equal(directed.paths[0][1].relationshipFromPrevious?.fromSymbolId, target.id);
    const reverseMissing = await alternatives.service.shortestPath(repositoryId, isolated.id, source.id, 2, ["CALLS"]);
    assert.equal(reverseMissing.found, false);

    const same = await alternatives.service.shortestPath(repositoryId, source.id, source.id, 0, ["CALLS"]);
    assert.equal(same.paths.length, 1);
    assert.equal(same.steps.length, 1);
    const depthExact = await alternatives.service.shortestPath(repositoryId, source.id, target.id, 2, ["CALLS"]);
    assert.equal(depthExact.found, true);
    const depthOverflow = await alternatives.service.shortestPath(repositoryId, source.id, target.id, 1, ["CALLS"]);
    assert.equal(depthOverflow.found, false, "paths beyond maxDepth are not returned");

    const filtered = await alternatives.service.shortestPath(repositoryId, source.id, target.id, 1, ["IMPORTS"]);
    assert.equal(filtered.paths[0][1].relationshipFromPrevious?.type, "IMPORTS");
    for (const relationshipType of ["IMPLEMENTS", "EXTENDS"] as const) {
        const selected = await service.service.shortestPath(repositoryId, source.id, target.id, 1, [relationshipType]);
        assert.equal(selected.paths[0][1].relationshipFromPrevious?.type, relationshipType);
    }
    const combined = await service.service.shortestPath(repositoryId, source.id, target.id, 1, ["CALLS", "IMPORTS"]);
    assert.equal(combined.paths.length, 2, "combined filters retain distinct relationship paths");

    const foreignOnly = makeService([source, target], [edge("foreign-only", source, target, "CALLS", foreignRepositoryId)],
        { maxProcessedEdges: 10, maxResults: 10 });
    assert.equal((await foreignOnly.service.shortestPath(repositoryId, source.id, target.id, 1, ["CALLS"])).found, false,
        "foreign repository edges are not traversed");
}

async function testShortestPathBudgets() {
    const source = symbol("budget-source", "source", "src/source.ts");
    const target = symbol("budget-target", "target", "src/a-target.ts");
    const otherA = symbol("budget-other-a", "otherA", "src/b-other.ts");
    const otherB = symbol("budget-other-b", "otherB", "src/c-other.ts");
    const exact = makeService([source, target, otherA], [edge("a-target", source, target), edge("b-other", source, otherA)],
        { maxProcessedEdges: 2, maxResults: 10 });
    const exactResult = await exact.service.shortestPath(repositoryId, source.id, target.id, 1, ["CALLS"]);
    assert.equal(exactResult.found, true);
    assert.equal(exactResult.traversalTruncated, false, "exact budget use is complete when the sentinel finds no additional edge");

    const exceeded = makeService([source, target, otherA, otherB], [edge("a-target", source, target), edge("b-other", source, otherA), edge("c-other", source, otherB)],
        { maxProcessedEdges: 2, maxResults: 10 });
    const exceededResult = await exceeded.service.shortestPath(repositoryId, source.id, target.id, 1, ["CALLS"]);
    assert.equal(exceededResult.found, true);
    assert.equal(exceededResult.traversalTruncated, true, "one edge beyond the SQL row budget is detected");
    assert.equal(exceededResult.pathsTruncated, true);
    assert.deepEqual(exceededResult, await exceeded.service.shortestPath(repositoryId, source.id, target.id, 1, ["CALLS"]),
        "the selected path and truncation indicators are deterministic at the budget boundary");

    const middle = symbol("budget-middle", "middle", "src/middle.ts");
    const shared = makeService([source, middle, target, otherA], [edge("source-middle", source, middle), edge("source-other", source, otherA),
        edge("middle-target", middle, target), edge("middle-other", middle, otherA)], { maxProcessedEdges: 3, maxResults: 10 });
    const sharedResult = await shared.service.shortestPath(repositoryId, source.id, target.id, 3, ["CALLS"]);
    assert.deepEqual(shared.repository.adjacencyBudgets, [3, 1], "the remaining edge budget is shared across BFS levels");
    assert.deepEqual(shared.repository.adjacencyDirections, ["OUTGOING", "OUTGOING"]);
    assert.equal(sharedResult.traversalTruncated, true, "the second adjacency query cannot reset the global budget");
}

await testBoundedAdjacencyQuery();
await testEdgeBudgets();
await testPathLimitCyclesIsolationAndLegacyOrder();
await testShortestPaths();
await testShortestPathBudgets();
console.log("Synthetic impact-bound tests passed.");
