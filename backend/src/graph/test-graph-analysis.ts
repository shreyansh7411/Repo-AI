import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { pool } from "../config/database.js";
import repositoryRoutes from "../ingestion/repository-routes.js";
import { createAuthenticatedTestSession } from "../test-utils/authenticated-test-session.js";

interface ApiError { error: { code: string; message: string } }
interface TraceBody { target: { id: string }; results: Array<{ symbol: { id: string; name: string; parentSymbolName: string | null }; depth: number; direct: boolean; relationship: { type: string } }> }

async function run() {
    const suffix = randomUUID();
    const session = await createAuthenticatedTestSession();
    let server: ReturnType<express.Express["listen"]> | undefined;
    try {
        const repoA = (await pool.query<{ id: string }>("INSERT INTO repositories(name,url,owner_user_id) VALUES($1::varchar,$1::text,$2) RETURNING id", [`m6-a-${suffix}`, session.userId])).rows[0].id;
        const repoB = (await pool.query<{ id: string }>("INSERT INTO repositories(name,url,owner_user_id) VALUES($1::varchar,$1::text,$2) RETURNING id", [`m6-b-${suffix}`, session.userId])).rows[0].id;
        const fileIds = new Map<string, string>();
        const addFile = async (repoId: string, path: string) => {
            const id = (await pool.query<{ id: string }>("INSERT INTO files(repository_id,path,language) VALUES($1,$2,'typescript') RETURNING id", [repoId, path])).rows[0].id;
            fileIds.set(`${repoId}:${path}`, id);
            return id;
        };
        const fileA = await addFile(repoA, "src/controller.ts");
        const fileB = await addFile(repoA, "src/service.ts");
        const fileC = await addFile(repoA, "src/repository.ts");
        const fileE = await addFile(repoA, "src/handler.ts");
        const fileF = await addFile(repoA, "src/contracts.ts");
        const fileG = await addFile(repoA, "src/implementation.ts");
        const fileI = await addFile(repoA, "src/isolated.ts");
        const fileOther = await addFile(repoB, "src/other.ts");
        const addSymbol = async (repoId: string, fileId: string, name: string, type = "FUNCTION", line = 1, parentId: string | null = null) =>
            (await pool.query<{ id: string }>(`INSERT INTO symbols(repository_id,file_id,name,type,start_line,end_line,parent_symbol_id)
                VALUES($1,$2,$3,$4,$5,$5+2,$6) RETURNING id`, [repoId, fileId, name, type, line, parentId])).rows[0].id;
        const controllerClass = await addSymbol(repoA, fileA, "Controller", "CLASS", 1);
        const a = await addSymbol(repoA, fileA, "Controller.handle", "METHOD", 2, controllerClass);
        const d = await addSymbol(repoA, fileA, "Batch.trigger", "METHOD", 10, controllerClass);
        const b = await addSymbol(repoA, fileB, "Service.reconcile", "METHOD", 2);
        const c = await addSymbol(repoA, fileC, "Repository.save", "METHOD", 3);
        const e = await addSymbol(repoA, fileE, "AsyncHandler.handle", "METHOD", 4);
        const contract = await addSymbol(repoA, fileF, "StorageContract", "INTERFACE", 1);
        const implementation = await addSymbol(repoA, fileG, "PgStorage", "CLASS", 2);
        const subclass = await addSymbol(repoA, fileG, "CachedPgStorage", "CLASS", 8);
        const importer = await addSymbol(repoA, fileI, "StorageModule", "CLASS", 3);
        const sameNameWithoutEdge = await addSymbol(repoA, fileI, "StorageModule", "CLASS", 7);
        const foreign = await addSymbol(repoB, fileOther, "ForeignCaller", "METHOD", 1);
        const insertEdges = async (repoId: string, rows: Array<[string, string, string]>) => {
            for (const [from, to, type] of rows) await pool.query(
                "INSERT INTO relationships(repository_id,source_symbol_id,target_symbol_id,type) VALUES($1,$2,$3,$4)", [repoId, from, to, type]);
        };
        await insertEdges(repoA, [[a,b,"CALLS"],[b,c,"CALLS"],[d,c,"CALLS"],[c,a,"CALLS"],[e,b,"CALLS"],[e,d,"CALLS"],
            [importer,c,"CALLS"],[importer,c,"IMPORTS"],[implementation,contract,"IMPLEMENTS"],[subclass,implementation,"EXTENDS"]]);
        // Deliberately invalid cross-repository edge: traversal must exclude it even if legacy data contains one.
        await insertEdges(repoB, [[foreign,c,"CALLS"]]);

        const app = express();
        app.use(express.json());
        app.use("/api/repositories", repositoryRoutes);
        server = app.listen(0);
        await new Promise<void>(resolve => server?.once("listening", resolve));
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const request = async <T>(path: string, body: unknown, expectedStatus = 200): Promise<T> => {
            const response = await fetch(`http://127.0.0.1:${address.port}/api/repositories/${repoA}${path}`, {
                method: "POST", headers: { "Content-Type": "application/json", Cookie: session.cookieHeader }, body: JSON.stringify(body)
            });
            const json = await response.json() as T | ApiError;
            assert.equal(response.status, expectedStatus, JSON.stringify(json));
            return json as T;
        };

        const callees = await request<TraceBody>("/trace/callees", { symbolId: a, maxDepth: 2 });
        assert.deepEqual(callees.results.map(hit => [hit.symbol.id, hit.depth]), [[b,1],[c,2]]);
        assert.equal(callees.target.id, a);
        const calleesRepeat = await request<TraceBody>("/trace/callees", { symbolId: a, maxDepth: 2 });
        assert.deepEqual(calleesRepeat, callees, "repeated execution must return stable ordering");
        const depthOne = await request<TraceBody>("/trace/callees", { symbolId: a, maxDepth: 1 });
        assert.deepEqual(depthOne.results.map(hit => hit.symbol.id), [b]);

        const callers = await request<TraceBody>("/trace/callers", { symbolId: c, maxDepth: 2 });
        assert.deepEqual(new Set(callers.results.map(hit => hit.symbol.id)), new Set([b,d,importer,a,e]));
        assert.equal(callers.results.every(hit => hit.relationship.type === "CALLS"), true);
        assert.equal(callers.results.some(hit => hit.symbol.id === foreign), false, "foreign repository node must not leak into traversal");
        assert.deepEqual(new Set(callers.results.filter(hit => hit.depth === 1).map(hit => hit.symbol.id)), new Set([b,d,importer]));
        assert.deepEqual(new Set(callers.results.filter(hit => hit.depth === 2).map(hit => hit.symbol.id)), new Set([a,e]));
        assert.equal(callers.results.find(hit => hit.symbol.id === a)?.symbol.parentSymbolName, "Controller");

        const shortest = await request<{ found: boolean; steps: Array<{ symbol: { id: string }; depth: number; relationshipFromPrevious: { type: string } | null }> }>(
            "/trace/path", { fromSymbolId: a, toSymbolId: c, maxDepth: 5, relationshipTypes: ["CALLS"] });
        assert.equal(shortest.found, true);
        assert.deepEqual(shortest.steps.map(step => step.symbol.id), [a,b,c]);
        assert.deepEqual(shortest.steps.map(step => step.relationshipFromPrevious?.type ?? null), [null,"CALLS","CALLS"]);
        const noPath = await request<{ found: boolean; steps: unknown[] }>(
            "/trace/path", { fromSymbolId: contract, toSymbolId: a, maxDepth: 5, relationshipTypes: ["CALLS"] });
        assert.deepEqual(noPath, { repositoryId: repoA, found: false, maxDepth: 5, relationshipTypes: ["CALLS"], steps: [] });
        const importPath = await request<{ found: boolean; steps: Array<{ symbol: { id: string }; relationshipFromPrevious: { type: string } | null }> }>(
            "/trace/path", { fromSymbolId: importer, toSymbolId: c, maxDepth: 1, relationshipTypes: ["IMPORTS"] });
        assert.equal(importPath.found, true);
        assert.equal(importPath.steps[1].relationshipFromPrevious?.type, "IMPORTS");

        const impact = await request<{ callers: Array<{ symbolId: string; depth: number; direct: boolean; category: string; classification: string; minDepth: number;
                evidencePaths: Array<{ direction: string; symbols: Array<{ id: string }>; relationships: Array<{ id: string; type: string; source: { id: string }; target: { id: string } }> }>; additionalPathsOmitted: boolean }>;
            importers: Array<{ symbolId: string; direct: boolean; category: string; evidenceScope: string; evidencePaths: Array<{ symbols: Array<{ id: string }>; relationships: Array<{ type: string }> }> }>;
            implementations: Array<{ symbolId: string; relationshipType: string; category: string }>;
            implementors: Array<{ symbolId: string; category: string }>;
            subclasses: Array<{ symbolId: string; category: string }>;
            affectedSymbols: Array<{ symbol: { id: string }; categories: string[]; evidencePaths: Array<{ category: string }> }>;
            pathsTruncated: boolean;
            affectedFiles: Array<{ fileId: string; path: string; minDepth: number; symbols: Array<{ symbolId: string }> }> }>(
            "/impact", { symbolId: c, maxDepth: 5 });
        assert.deepEqual(new Set(impact.callers.map(hit => hit.symbolId)), new Set([a,b,d,e,importer]));
        assert.equal(impact.callers.some(hit => hit.symbolId === c), false, "a cycle must not report the selected target as affected by itself");
        const directCaller = impact.callers.find(hit => hit.symbolId === b);
        assert.ok(directCaller);
        assert.equal(directCaller.category, "caller");
        assert.equal(directCaller.classification, "direct");
        assert.equal(directCaller.minDepth, 1);
        assert.deepEqual(directCaller.evidencePaths[0].symbols.map(symbol => symbol.id), [c,b]);
        assert.deepEqual(directCaller.evidencePaths[0].relationships.map(edge => [edge.source.id, edge.target.id, edge.type]), [[b,c,"CALLS"]]);
        const multiHopCaller = impact.callers.find(hit => hit.symbolId === e);
        assert.ok(multiHopCaller);
        assert.equal(multiHopCaller.classification, "indirect");
        assert.equal(multiHopCaller.minDepth, 2);
        assert.deepEqual(multiHopCaller.evidencePaths.map(path => path.symbols.map(symbol => symbol.id)), [[c,d,e],[c,b,e]]);
        assert.equal(multiHopCaller.evidencePaths.every(path => path.relationships.every(edge => edge.type === "CALLS")), true);
        assert.equal(multiHopCaller.evidencePaths.every(path => new Set(path.symbols.map(symbol => symbol.id)).size === path.symbols.length), true,
            "cycles must not repeat symbols within an evidence path");
        assert.equal(multiHopCaller.additionalPathsOmitted, false);
        assert.equal(impact.pathsTruncated, false);
        assert.equal(impact.importers[0].symbolId, importer);
        assert.equal(impact.importers[0].category, "importer");
        assert.equal(impact.importers[0].evidenceScope, "FILE");
        assert.deepEqual(impact.importers[0].evidencePaths[0].symbols.map(symbol => symbol.id), [c,importer]);
        assert.deepEqual(impact.importers[0].evidencePaths[0].relationships.map(edge => edge.type), ["IMPORTS"]);
        assert.equal(impact.importers.some(item => item.symbolId === sameNameWithoutEdge), false,
            "same-name symbols without a stored relationship must not be guessed as impact evidence");
        const importerAndCaller = impact.affectedSymbols.find(item => item.symbol.id === importer);
        assert.ok(importerAndCaller);
        assert.deepEqual(importerAndCaller.categories, ["caller", "importer"]);
        assert.deepEqual(importerAndCaller.evidenceScopes, ["FILE", "SYMBOL"]);
        assert.equal(impact.affectedSymbols.filter(item => item.symbol.id === importer).length, 1,
            "aggregate impact symbols are deduplicated across categories");
        const controllerFile = impact.affectedFiles.find(file => file.fileId === fileA);
        assert.ok(controllerFile);
        assert.equal(controllerFile.minDepth, 1);
        assert.deepEqual(new Set(controllerFile.symbols.map(symbol => symbol.symbolId)), new Set([a,d]));
        const implementationImpact = await request<{ implementations: Array<{ symbolId: string; relationshipType: string }> }>(
            "/impact", { symbolId: contract, maxDepth: 1 });
        assert.deepEqual(implementationImpact.implementations.map(hit => [hit.symbolId, hit.relationshipType]), [[implementation,"IMPLEMENTS"]]);
        const implementationDetail = await request<{ implementors: Array<{ symbolId: string; category: string; evidencePaths: Array<{ symbols: Array<{ id: string }>; relationships: Array<{ type: string }> }> }> }>(
            "/impact", { symbolId: contract, maxDepth: 1 });
        assert.deepEqual(implementationDetail.implementors[0].evidencePaths[0].symbols.map(symbol => symbol.id), [contract,implementation]);
        assert.equal(implementationDetail.implementors[0].category, "implementor");
        const subclassImpact = await request<{ subclasses: Array<{ symbolId: string; category: string; evidencePaths: Array<{ symbols: Array<{ id: string }>; relationships: Array<{ type: string }> }> }>;
            implementations: Array<{ symbolId: string; relationshipType: string }> }>(
            "/impact", { symbolId: implementation, maxDepth: 1 });
        assert.equal(subclassImpact.subclasses[0].symbolId, subclass);
        assert.equal(subclassImpact.subclasses[0].category, "subclass");
        assert.deepEqual(subclassImpact.subclasses[0].evidencePaths[0].symbols.map(symbol => symbol.id), [implementation,subclass]);
        assert.deepEqual(subclassImpact.subclasses[0].evidencePaths[0].relationships.map(edge => edge.type), ["EXTENDS"]);
        assert.deepEqual(subclassImpact.implementations.map(item => [item.symbolId, item.relationshipType]), [[subclass, "EXTENDS"]],
            "legacy implementations field includes subclass evidence");
        const impactRepeat = await request<typeof impact>("/impact", { symbolId: c, maxDepth: 5 });
        assert.deepEqual(impactRepeat, impact, "impact paths and legacy fields remain deterministic");
        assert.equal(impact.affectedSymbols.filter(item => item.symbol.id === e).length, 1, "each symbol appears once in the aggregate group");
        assert.deepEqual(impact.affectedSymbols.find(item => item.symbol.id === e)?.categories, ["caller"]);

        const empty = await request<TraceBody>("/trace/callers", { symbolId: await addSymbol(repoA, fileI, "NoEdges"), maxDepth: 2 });
        assert.deepEqual(empty.results, []);
        const emptyImpact = await request<{ callers: unknown[]; importers: unknown[]; implementations: unknown[]; affectedSymbols: unknown[];
            traversalTruncated: boolean; evidencePathsTruncated: boolean; resultsTruncated: boolean }>(
            "/impact", { symbolId: empty.target.id, maxDepth: 5 });
        assert.deepEqual(emptyImpact, { repositoryId: repoA, target: empty.target, maxDepth: 5, callers: [], importers: [], implementations: [],
            implementors: [], subclasses: [], affectedSymbols: [], affectedFiles: [], edgeProcessingLimit: 10000, resultLimit: 1000,
            evidencePathLimit: 5, traversalTruncated: false,
            evidencePathsTruncated: false, resultsTruncated: false, pathsTruncated: false,
            interpretation: "Graph-derived dependencies only; static relationships do not guarantee runtime execution or capture every semantic effect of a change. Import evidence identifies a dependent file and does not prove that a particular symbol uses the imported symbol. If any truncation flag is true, the returned groups may omit affected symbols or evidence paths." });
        const missing = await request<ApiError>("/trace/callers", { symbolId: randomUUID() }, 404);
        assert.equal(missing.error.code, "SYMBOL_NOT_FOUND");
        const invalidPair = await request<ApiError>("/trace/callers", { symbolId: foreign }, 404);
        assert.equal(invalidPair.error.code, "SYMBOL_NOT_FOUND");
        await request<ApiError>("/trace/callers", { symbolId: a, maxDepth: 6 }, 400);
        await request<ApiError>("/trace/callees", { symbolId: "bad" }, 400);
        await request<ApiError>("/trace/path", { fromSymbolId: a, toSymbolId: c, relationshipTypes: ["USES"] }, 400);
        const unknownRepoResponse = await fetch(`http://127.0.0.1:${address.port}/api/repositories/${randomUUID()}/impact`, {
            method: "POST", headers: { "Content-Type": "application/json", Cookie: session.cookieHeader }, body: JSON.stringify({ symbolId: a })
        });
        assert.equal(unknownRepoResponse.status, 404);
        console.log("Milestone 6 PostgreSQL/API tests passed: callers, callees, depth, cycle guard, repository isolation, relationship filters, deterministic ordering, shortest/no path, impact, file dedupe, missing symbols, and validation.");
    } finally {
        try {
            if (server) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
        } finally {
            try { await session.cleanup(); }
            finally { await pool.end(); }
        }
    }
}

await run();
