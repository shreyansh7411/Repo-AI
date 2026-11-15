import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { pool } from "../config/database.js";
import repositoryRoutes from "../ingestion/repository-routes.js";
import type { GraphSymbol } from "../graph/types.js";
import { createAuthenticatedTestSession } from "../test-utils/authenticated-test-session.js";
import type { RepositoryQueryDependencies } from "./repository-query-service.js";
import { RepositoryQueryService } from "./repository-query-service.js";
import { createRepositoryQueryHandlers } from "./repository-query-controller.js";

const repositoryId = randomUUID();
const sourceSymbol: GraphSymbol = { id: "00000000-0000-4000-8000-000000000001", name: "reconcile", type: "METHOD", fileId: "file-a", filePath: "src/reconcile.ts", language: "typescript", startLine: 2, endLine: 8, parentSymbolId: null, parentSymbolName: null, parentSymbolType: null };
const targetSymbol: GraphSymbol = { ...sourceSymbol, id: "00000000-0000-4000-8000-000000000002", name: "save", fileId: "file-b", filePath: "src/store.ts", startLine: 3, endLine: 5 };

function makeService(embeddingFails = false, repositoryExists = true) {
    const calls: string[] = [];
    const structuralSource = { id: sourceSymbol.id, repositoryId, fileId: "file-a", filePath: "src/reconcile.ts", language: "typescript", name: "reconcile", symbolType: "METHOD", startLine: 2, endLine: 8, signature: "reconcile()" };
    const structuralTarget = { id: targetSymbol.id, repositoryId, fileId: "file-b", filePath: "src/store.ts", language: "typescript", name: "save", symbolType: "METHOD", startLine: 3, endLine: 5, signature: "save()" };
    const dependencies = {
        metadata: {
            repositoryExists: async () => repositoryExists,
            getSymbol: async (_repoId: string, id: string) => id === sourceSymbol.id ? {
                id, name: "reconcile", type: "METHOD", signature: "reconcile()", file: { id: "file-a", path: "src/reconcile.ts", language: "typescript" }, startLine: 2, endLine: 8, parent: null
            } : null,
            getFile: async (_repoId: string, path: string) => path === "src/reconcile.ts" ? ({ id: "file-a", path, language: "typescript", size: 100, hash: "hash", symbols: [], chunkCount: 1 }) : null,
            listSymbols: async () => ({ totalCount: 1, symbols: [{ id: sourceSymbol.id, name: "reconcile", type: "METHOD" as const, file: { id: "file-a", path: "src/reconcile.ts", language: "typescript" }, startLine: 2, endLine: 8, signature: "reconcile()", parent: null }] })
        },
        embeddings: { embedQuery: async () => { calls.push("embedding"); if (embeddingFails) throw new Error("Gemini request failed (HTTP 403): private detail"); return [1]; } },
        chunks: { search: async () => { calls.push("semantic-search"); return [{ id: "chunk-id", repositoryId, fileId: "file-a", filePath: "src/reconcile.ts", symbolId: sourceSymbol.id, symbolName: "reconcile", symbolType: "METHOD", startLine: 2, endLine: 8, content: "reconcile()", similarity: 0.9 }]; } },
        structural: {
            findMatchingSymbols: async () => { calls.push("structural-match"); return [structuralSource]; },
            expand: async () => { calls.push("structural-expand"); return { symbols: [], relationships: [] }; },
            getSymbolChunks: async () => { calls.push("structural-chunks"); return [{ id: "struct-chunk", repositoryId, fileId: "file-a", filePath: "src/reconcile.ts", symbolId: sourceSymbol.id, symbolName: "reconcile", symbolType: "METHOD", startLine: 2, endLine: 8, content: "reconcile()" }]; }
        },
        hybrid: { retrieve: async () => { calls.push("hybrid"); return { repositoryId, query: "reconcile", semantic: [], semanticError: "Gemini request failed (HTTP 403): secret", symbols: [structuralSource, structuralTarget], relationships: [{ id: "hybrid-edge", type: "CALLS", source: structuralSource, target: structuralTarget }], evidence: [
            { id: "relationship:hybrid-edge", kind: "RELATIONSHIP", provenance: "STRUCTURAL", repositoryId, filePath: structuralSource.filePath, symbolId: structuralSource.id, symbol: structuralSource.name, symbolType: structuralSource.symbolType, startLine: 2, endLine: 8, content: "reconcile calls save", relationship: { id: "hybrid-edge", type: "CALLS", source: structuralSource.name, target: structuralTarget.name }, score: 0.7 },
            { id: "chunk:hybrid-chunk", kind: "CHUNK", provenance: "BOTH", repositoryId, filePath: structuralSource.filePath, symbolId: structuralSource.id, symbol: structuralSource.name, symbolType: structuralSource.symbolType, startLine: 2, endLine: 8, content: "reconcile()", similarity: 0.8, score: 1.5 }
        ], context: "", contextChars: 0, truncated: false }; } },
        graph: {
            trace: async (_repo: string, id: string, direction: "INCOMING" | "OUTGOING", maxDepth: number) => ({ repositoryId, direction, target: id === sourceSymbol.id ? sourceSymbol : targetSymbol, maxDepth, relationshipTypes: ["CALLS" as const], results: [{ symbol: targetSymbol, depth: 1, direct: true, relationship: { id: "edge-id", type: "CALLS" as const, fromSymbolId: sourceSymbol.id, toSymbolId: targetSymbol.id } }] }),
            impact: async () => { calls.push("impact"); return {
                repositoryId, target: sourceSymbol, maxDepth: 2,
                callers: [{ symbolId: targetSymbol.id, name: targetSymbol.name, type: targetSymbol.type, fileId: targetSymbol.fileId,
                    filePath: targetSymbol.filePath, language: targetSymbol.language, startLine: targetSymbol.startLine, endLine: targetSymbol.endLine,
                    parentSymbolId: null, parentSymbolName: null, depth: 1, direct: true, relationshipType: "CALLS", relationshipId: "impact-edge",
                    category: "caller", evidenceScope: "SYMBOL", classification: "direct", minDepth: 1, symbol: targetSymbol,
                    file: { id: targetSymbol.fileId, path: targetSymbol.filePath, language: targetSymbol.language },
                    evidencePaths: [{ direction: "INCOMING", symbols: [sourceSymbol, targetSymbol], relationships: [{ id: "impact-edge", type: "CALLS", source: targetSymbol, target: sourceSymbol }] }],
                    additionalPathsOmitted: false }],
                importers: [], implementations: [], implementors: [], subclasses: [],
                affectedSymbols: [{ symbol: targetSymbol, file: { id: targetSymbol.fileId, path: targetSymbol.filePath, language: targetSymbol.language },
                    categories: ["caller"], evidenceScopes: ["SYMBOL"], classification: "direct", minDepth: 1,
                    evidencePaths: [{ direction: "INCOMING", category: "caller", symbols: [sourceSymbol, targetSymbol], relationships: [{ id: "impact-edge", type: "CALLS", source: targetSymbol, target: sourceSymbol }] }],
                    additionalPathsOmitted: false }],
                affectedFiles: [], edgeProcessingLimit: 10000, resultLimit: 1000, evidencePathLimit: 5,
                traversalTruncated: false, evidencePathsTruncated: false, resultsTruncated: false, pathsTruncated: false,
                interpretation: "Static graph evidence."
            }; },
            shortestPath: async () => { calls.push("path"); return { repositoryId, found: true, maxDepth: 5, relationshipTypes: ["CALLS" as const], steps: [{ symbol: sourceSymbol, depth: 0, relationshipFromPrevious: null }, { symbol: targetSymbol, depth: 1, relationshipFromPrevious: { id: "edge-id", type: "CALLS" as const, fromSymbolId: sourceSymbol.id, toSymbolId: targetSymbol.id } }] }; }
        }
    } as unknown as RepositoryQueryDependencies;
    return { service: new RepositoryQueryService(dependencies), calls };
}

function fakeResponse() {
    let statusCode = 200;
    let body: unknown;
    const response = { status(code: number) { statusCode = code; return response; }, json(payload: unknown) { body = payload; return response; } } as unknown as Response;
    return { response, status: () => statusCode, body: () => body };
}

async function unitTests() {
    const { service, calls } = makeService();
    const symbol = await service.symbol(repositoryId, sourceSymbol.id);
    assert.equal(symbol.signature, "reconcile()");
    const symbols = await service.listSymbols(repositoryId, { page: 1, pageSize: 10, type: null, search: null });
    assert.equal(symbols.totalPages, 1);
    assert.equal(symbols.symbols[0].name, "reconcile");
    assert.equal((await service.file(repositoryId, "src/reconcile.ts")).chunkCount, 1);
    assert.equal((await service.search(repositoryId, "reconcile", "semantic", 5, 1)).evidence[0].similarity, 0.9);
    assert.ok(calls.includes("semantic-search"));
    assert.equal((await service.search(repositoryId, "reconcile", "structural", 5, 1)).evidence[0].source, "STRUCTURAL");
    assert.ok(calls.includes("structural-expand"));
    const hybrid = await service.search(repositoryId, "reconcile", "hybrid", 5, 5);
    assert.equal(hybrid.semanticAvailable, false);
    assert.equal(hybrid.semanticError, "Semantic retrieval is unavailable (upstream HTTP 403).");
    assert.ok(calls.includes("hybrid"));
    assert.equal(hybrid.evidence[0].relationship?.sourceSymbol.id, sourceSymbol.id);
    assert.equal(hybrid.evidence[0].relationship?.targetSymbol.id, targetSymbol.id);
    assert.equal(hybrid.evidence[1].source, "BOTH");
    assert.equal(hybrid.evidence[1].file.id, "file-a");
    assert.equal(hybrid.maxDepth, 5);
    assert.equal(hybrid.effectiveMaxDepth, 2);
    const callers = await service.trace(repositoryId, sourceSymbol.id, "callers", 2);
    assert.equal(callers.direction, "callers");
    assert.equal(callers.results[0].relationship.type, "CALLS");
    assert.deepEqual(callers, await service.trace(repositoryId, sourceSymbol.id, "callers", 2), "same graph query should serialize deterministically");
    await service.trace(repositoryId, sourceSymbol.id, "callees", 2);
    const impact = await service.impact(repositoryId, sourceSymbol.id, 2);
    assert.equal(impact.affectedSymbols[0].evidencePaths[0].relationships[0].id, "impact-edge", "query layer preserves graph evidence paths");
    assert.equal(impact.callers[0].category, "caller");
    const path = await service.path(repositoryId, sourceSymbol.id, targetSymbol.id, 5);
    assert.equal(path.pathLength, 1);
    assert.equal(path.steps[1].relationshipFromPrevious?.type, "CALLS");

    const failureService = makeService(true).service;
    const fallback = await failureService.search(repositoryId, "reconcile", "semantic", 5, 1);
    assert.equal(fallback.semanticAvailable, false);
    assert.equal(fallback.evidence[0].source, "STRUCTURAL");

    const handlers = createRepositoryQueryHandlers(service);
    const invalidMode = fakeResponse();
    await handlers.search({ params: { repositoryId }, body: { query: "foo", mode: "magic" } } as unknown as Request, invalidMode.response);
    assert.equal(invalidMode.status(), 400);
    const invalidDirection = fakeResponse();
    await handlers.trace({ params: { repositoryId }, body: { symbolId: sourceSymbol.id, direction: "both" } } as unknown as Request, invalidDirection.response);
    assert.equal(invalidDirection.status(), 400);
    const invalidSymbolFilter = fakeResponse();
    await handlers.symbols({ params: { repositoryId }, query: { type: "PACKAGE" } } as unknown as Request, invalidSymbolFilter.response);
    assert.equal(invalidSymbolFilter.status(), 400);
    const missingSymbol = fakeResponse();
    await handlers.symbol({ params: { repositoryId }, body: { symbolId: targetSymbol.id } } as unknown as Request, missingSymbol.response);
    assert.equal(missingSymbol.status(), 404);
    const missingFile = fakeResponse();
    await handlers.file({ params: { repositoryId }, body: { path: "no-such-file.ts" } } as unknown as Request, missingFile.response);
    assert.equal(missingFile.status(), 404);
    const absentRepository = fakeResponse();
    await createRepositoryQueryHandlers(makeService(false, false).service).symbol({ params: { repositoryId }, body: { symbolId: sourceSymbol.id } } as unknown as Request, absentRepository.response);
    assert.equal(absentRepository.status(), 404);
    for (const [body, expected] of [[{ query: "x", mode: "structural", topK: 0 }, 400], [{ query: "x", mode: "structural", maxDepth: 6 }, 400], [{ symbolId: "bad" }, 400], [{ path: " " }, 400]] as const) {
        const targetHandler = "query" in body ? handlers.search : "symbolId" in body ? handlers.symbol : handlers.file;
        const response = fakeResponse();
        await targetHandler({ params: { repositoryId }, body } as unknown as Request, response.response);
        assert.equal(response.status(), expected);
    }
    console.log("Repository query unit tests passed: lookup, search delegation, trace, impact, path, evidence, fallback, and validation.");
}

async function postgresAndApiTests() {
    const session = await createAuthenticatedTestSession();
    const suffix = randomUUID();
    let server: ReturnType<express.Express["listen"]> | undefined;
    try {
        const fixtureRepositoryId = (await pool.query<{ id: string }>(
            "INSERT INTO repositories(name,url,owner_user_id) VALUES($1,$2,$3) RETURNING id",
            [`m7-query-${suffix}`, `https://example.test/m7-query-${suffix}.git`, session.userId]
        )).rows[0].id;
        const foreignRepoId = (await pool.query<{ id: string }>(
            "INSERT INTO repositories(name,url,owner_user_id) VALUES($1,$2,$3) RETURNING id",
            [`m7-isolation-${suffix}`, `https://example.test/m7-isolation-${suffix}.git`, session.userId]
        )).rows[0].id;
        const sourceFileId = (await pool.query<{ id: string }>(
            "INSERT INTO files(repository_id,path,language,size,hash) VALUES($1,$2,'typescript',128,$3) RETURNING id",
            [fixtureRepositoryId, "src/reconciliation.ts", `hash-${suffix}`]
        )).rows[0].id;
        const targetFileId = (await pool.query<{ id: string }>(
            "INSERT INTO files(repository_id,path,language,size,hash) VALUES($1,$2,'typescript',64,$3) RETURNING id",
            [fixtureRepositoryId, "src/payment-store.ts", `store-${suffix}`]
        )).rows[0].id;
        const source = (await pool.query<{ id: string }>(
            `INSERT INTO symbols(repository_id,file_id,name,type,start_line,end_line,signature)
             VALUES($1,$2,'reconcilePayment','METHOD',2,8,'reconcilePayment()') RETURNING id`,
            [fixtureRepositoryId, sourceFileId]
        )).rows[0].id;
        const target = (await pool.query<{ id: string }>(
            `INSERT INTO symbols(repository_id,file_id,name,type,start_line,end_line,signature)
             VALUES($1,$2,'savePayment','METHOD',3,6,'savePayment(payment)') RETURNING id`,
            [fixtureRepositoryId, targetFileId]
        )).rows[0].id;
        const foreignFileId = (await pool.query<{ id: string }>(
            "INSERT INTO files(repository_id,path,language) VALUES($1,'foreign.ts','typescript') RETURNING id", [foreignRepoId]
        )).rows[0].id;
        const foreignSymbolId = (await pool.query<{ id: string }>(
            "INSERT INTO symbols(repository_id,file_id,name,type,start_line,end_line) VALUES($1,$2,'foreign','FUNCTION',1,1) RETURNING id",
            [foreignRepoId, foreignFileId]
        )).rows[0].id;
        await pool.query("INSERT INTO relationships(repository_id,source_symbol_id,target_symbol_id,type) VALUES($1,$2,$3,'CALLS')",
            [fixtureRepositoryId, source, target]);
        await pool.query(
            "INSERT INTO code_chunks(repository_id,file_id,symbol_id,start_line,end_line,content) VALUES($1,$2,$3,2,8,$4)",
            [fixtureRepositoryId, sourceFileId, source, "async function reconcilePayment() { return savePayment(); }"]
        );

        const app = express(); app.use(express.json()); app.use("/api/repositories", repositoryRoutes);
        server = app.listen(0);
        await new Promise<void>(resolve => server?.once("listening", resolve));
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}/api/repositories/${fixtureRepositoryId}/query`;
        const post = async <T>(path: string, body: unknown, expectedStatus = 200): Promise<T> => {
            const response = await fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json", Cookie: session.cookieHeader }, body: JSON.stringify(body) });
            assert.equal(response.status, expectedStatus, `${path} status`);
            return await response.json() as T;
        };
        const symbol = await post<{ id: string; name: string; file: { path: string }; signature: string | null }>("symbol", { symbolId: source });
        assert.equal(symbol.id, source);
        const file = await post<{ id: string; symbols: unknown[]; chunkCount: number }>("file", { path: "src\\reconciliation.ts" });
        assert.ok(file.id); assert.ok(Array.isArray(file.symbols)); assert.ok(file.chunkCount >= 0);
        assert.equal(file.id, sourceFileId);
        const structural = await post<{ mode: string; semanticAvailable: null; evidence: Array<{ file: { path: string }; source: string }> }>("search", { query: "reconcilePayment", mode: "structural", topK: 5, maxDepth: 1 });
        assert.equal(structural.mode, "structural"); assert.ok(structural.evidence.every(item => item.source === "STRUCTURAL"));
        const callees = await post<{ target: { id: string }; results: Array<{ symbol: { id: string }; relationship: { type: string } }> }>("trace", { symbolId: source, direction: "callees", maxDepth: 1 });
        assert.ok(callees.results.some(item => item.symbol.id === target && item.relationship.type === "CALLS"));
        const callers = await post<{ results: Array<{ symbol: { id: string } }> }>("trace", { symbolId: target, direction: "callers", maxDepth: 1 });
        assert.ok(callers.results.some(item => item.symbol.id === source));
        const impact = await post<{ target: { id: string }; callers: Array<{ symbolId: string; evidencePaths: Array<{ symbols: Array<{ id: string }>; relationships: Array<{ source: { id: string }; target: { id: string }; type: string }> }> }>;
            affectedSymbols: unknown[]; affectedFiles: unknown[] }>("impact", { symbolId: target, maxDepth: 2 });
        assert.equal(impact.target.id, target); assert.ok(Array.isArray(impact.callers)); assert.ok(Array.isArray(impact.affectedFiles));
        const realCaller = impact.callers.find(item => item.symbolId === source);
        assert.ok(realCaller, "impact API returns the actual fixture caller");
        assert.deepEqual(realCaller.evidencePaths[0].symbols.map(symbol => symbol.id), [target, source]);
        assert.ok(realCaller.evidencePaths[0].relationships.some(item => item.source.id === source && item.target.id === target && item.type === "CALLS"));
        assert.ok(Array.isArray(impact.affectedSymbols));
        const path = await post<{ found: boolean; pathLength: number; steps: Array<{ symbol: { id: string }; file: { path: string } }> }>("path", { fromSymbolId: source, toSymbolId: target, maxDepth: 5 });
        assert.equal(path.found, true); assert.equal(path.pathLength, 1); assert.equal(path.steps.length, 2);
        const isolatedSymbol = await post<{ error: { code: string } }>("symbol", { symbolId: foreignSymbolId }, 404);
        assert.equal(isolatedSymbol.error.code, "SYMBOL_NOT_FOUND");
        const isolatedFile = await post<{ error: { code: string } }>("file", { path: "foreign.ts" }, 404);
        assert.equal(isolatedFile.error.code, "FILE_NOT_FOUND");
        console.log(`Repository query PostgreSQL/API tests passed: fixture symbol ${symbol.name}, file ${file.id}, structural evidence ${structural.evidence.length}, CALLS ${source} -> ${target}, real trace/impact/path, and foreign repository isolation.`);
    } finally {
        try {
            if (server) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
        } finally {
            await session.cleanup();
        }
    }
}

try { await unitTests(); await postgresAndApiTests(); }
finally { await pool.end(); }
