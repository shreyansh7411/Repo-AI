import assert from "node:assert/strict";
import express from "express";
import { pool } from "../config/database.js";
import repositoryRoutes from "../ingestion/repository-routes.js";
import type { GraphSymbol, PathStep, TraversalHit } from "./types.js";

const repositoryId = "d99205ac-705c-4fc5-bd44-47cc7db1973b";
interface TraceApiResult { target: GraphSymbol; results: TraversalHit[] }
interface PathApiResult { found: boolean; steps: PathStep[] }
interface ImpactItem { symbolId: string; name: string; type: string; fileId: string; filePath: string; language: string | null;
    startLine: number; endLine: number; parentSymbolId: string | null; parentSymbolName: string | null;
    depth: number; direct: boolean; relationshipType: string; relationshipId: string }
interface ImpactApiResult { target: GraphSymbol; callers: ImpactItem[]; importers: ImpactItem[]; implementations: ImpactItem[];
    affectedFiles: Array<{ path: string; minDepth: number; relationshipTypes: string[] }> }

async function run() {
    const chain = await pool.query<{ startId: string; endId: string; depth: number }>(
        `WITH RECURSIVE paths(start_id,current_id,depth,visited) AS (
             SELECT r.source_symbol_id,r.target_symbol_id,1,ARRAY[r.source_symbol_id,r.target_symbol_id]::uuid[]
             FROM relationships r WHERE r.repository_id=$1 AND r.type='CALLS'
             UNION ALL
             SELECT p.start_id,r.target_symbol_id,p.depth+1,p.visited||r.target_symbol_id
             FROM paths p JOIN relationships r ON r.source_symbol_id=p.current_id AND r.repository_id=$1 AND r.type='CALLS'
             WHERE p.depth<5 AND NOT r.target_symbol_id=ANY(p.visited)
         )
         SELECT start_id AS "startId",current_id AS "endId",depth FROM paths WHERE depth=2
         ORDER BY depth,start_id,current_id LIMIT 1`, [repositoryId]);
    assert.ok(chain.rows[0], "production repository should contain a multi-level CALLS chain");
    const [importEdge, implementationEdge] = await Promise.all([
        pool.query<{ sourceId: string; targetId: string; type: string }>("SELECT source_symbol_id AS \"sourceId\",target_symbol_id AS \"targetId\",type FROM relationships WHERE repository_id=$1 AND type='IMPORTS' ORDER BY id LIMIT 1", [repositoryId]),
        pool.query<{ sourceId: string; targetId: string; type: string }>("SELECT source_symbol_id AS \"sourceId\",target_symbol_id AS \"targetId\",type FROM relationships WHERE repository_id=$1 AND type='IMPLEMENTS' ORDER BY id LIMIT 1", [repositoryId])
    ]);
    assert.ok(importEdge.rows[0] && implementationEdge.rows[0]);
    const app = express();
    app.use(express.json());
    app.use("/api/repositories", repositoryRoutes);
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not start production graph verification server.");
    const post = async <T>(path: string, body: unknown) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/repositories/${repositoryId}${path}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        const json = await response.json() as T;
        assert.equal(response.status, 200, JSON.stringify(json));
        return json;
    };
    try {
        const callees = await post<TraceApiResult>(
            "/trace/callees", { symbolId: chain.rows[0].startId, maxDepth: 2 });
        assert.ok(callees.results.some(item => item.symbol.id === chain.rows[0].endId && item.depth === chain.rows[0].depth));
        const callers = await post<TraceApiResult>(
            "/trace/callers", { symbolId: chain.rows[0].endId, maxDepth: 2 });
        assert.ok(callers.results.length > 0);
        const impact = await post<ImpactApiResult>(
            "/impact", { symbolId: chain.rows[0].endId, maxDepth: 2 });
        const path = await post<PathApiResult>(
            "/trace/path", { fromSymbolId: chain.rows[0].startId, toSymbolId: chain.rows[0].endId, maxDepth: 5, relationshipTypes: ["CALLS"] });
        assert.equal(path.found, true);
        assert.equal(path.steps.at(-1)?.symbol.id, chain.rows[0].endId);
        const importPath = await post<PathApiResult>(
            "/trace/path", { fromSymbolId: importEdge.rows[0].sourceId, toSymbolId: importEdge.rows[0].targetId, maxDepth: 1, relationshipTypes: ["IMPORTS"] });
        const implementsPath = await post<PathApiResult>(
            "/trace/path", { fromSymbolId: implementationEdge.rows[0].sourceId, toSymbolId: implementationEdge.rows[0].targetId, maxDepth: 1, relationshipTypes: ["IMPLEMENTS"] });
        assert.equal(importPath.found, true);
        assert.equal(importPath.steps[1].relationshipFromPrevious?.type, "IMPORTS");
        assert.equal(implementsPath.found, true);
        assert.equal(implementsPath.steps[1].relationshipFromPrevious?.type, "IMPLEMENTS");

        const [counts, integrity] = await Promise.all([
            pool.query(`WITH types(type) AS (VALUES ('CALLS'),('EXTENDS'),('IMPLEMENTS'),('IMPORTS'))
                SELECT types.type,COUNT(r.id)::int AS count FROM types LEFT JOIN relationships r
                ON r.type=types.type AND r.repository_id=$1 GROUP BY types.type ORDER BY types.type`, [repositoryId]),
            pool.query(`SELECT
                (SELECT COUNT(*) FROM (SELECT source_symbol_id,target_symbol_id,type FROM relationships WHERE repository_id=$1 GROUP BY source_symbol_id,target_symbol_id,type HAVING COUNT(*)>1) d)::int AS duplicates,
                (SELECT COUNT(*) FROM relationships r JOIN symbols s ON s.id=r.source_symbol_id JOIN symbols t ON t.id=r.target_symbol_id WHERE r.repository_id=$1 AND (s.repository_id<>$1 OR t.repository_id<>$1))::int AS cross_repository`, [repositoryId])
        ]);
        assert.deepEqual(integrity.rows[0], { duplicates: 0, cross_repository: 0 });
        assert.deepEqual(Object.fromEntries(counts.rows.map(row => [row.type, row.count])),
            { CALLS: 402, EXTENDS: 0, IMPLEMENTS: 5, IMPORTS: 366 });
        assert.equal(counts.rows.reduce((sum, row) => sum + row.count, 0), 773);
        assert.equal(path.steps.length, 3);
        console.log(JSON.stringify({ repositoryId, calls: { start: briefSymbol(callees.target), chain: callees.results.filter(item => item.depth <= 2).slice(0, 8).map(item => ({
                symbol: briefSymbol(item.symbol), depth: item.depth, relationship: item.relationship.type })) },
            callers: callers.results.slice(0, 8).map(item => ({ symbol: briefSymbol(item.symbol), depth: item.depth, relationship: item.relationship.type })),
            impact: { target: briefSymbol(impact.target), callerCount: impact.callers.length,
                importerCount: impact.importers.length, affectedFiles: impact.affectedFiles.map(file => ({ path: file.path, minDepth: file.minDepth, relationshipTypes: file.relationshipTypes })) },
            path: path.steps.map(step => ({ symbol: briefSymbol(step.symbol), depth: step.depth, via: step.relationshipFromPrevious?.type ?? null })),
            importsPath: importPath.steps.map(step => ({ symbol: briefSymbol(step.symbol), via: step.relationshipFromPrevious?.type ?? null })),
            implementsPath: implementsPath.steps.map(step => ({ symbol: briefSymbol(step.symbol), via: step.relationshipFromPrevious?.type ?? null })),
            relationshipCounts: counts.rows, integrity: integrity.rows[0] }));
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await pool.end();
    }
}

function briefSymbol(symbol: { id: string; name: string; filePath: string; startLine: number; endLine: number }) {
    return { id: symbol.id, name: symbol.name, filePath: symbol.filePath, lines: `${symbol.startLine}-${symbol.endLine}` };
}

try { await run(); }
catch (error) { console.error(error instanceof Error ? error.message : "Production graph verification failed."); process.exitCode = 1; }
