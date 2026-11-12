import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { pool } from "../config/database.js";
import repositoryRoutes from "../ingestion/repository-routes.js";

interface SymbolPage { repositoryId: string; page: number; pageSize: number; totalCount: number; totalPages: number; symbols: Array<{ id: string; name: string; type: string; file: { path: string }; startLine: number; endLine: number; parent: { name: string } | null }> }
interface SymbolDetails { id: string; name: string; type: string; signature: string | null; parent: { name: string; type: string } | null; sourceContext: { startLine: number; endLine: number; content: string } | null }
interface ApiError { error: { code: string; message: string } }

const ids = { repositoryA: randomUUID(), repositoryB: randomUUID(), emptyRepository: randomUUID(), fileA: randomUUID(), fileB: randomUUID(), class: randomUUID(), method: randomUUID(), function: randomUUID(), foreign: randomUUID() };
const suffix = randomUUID();
const repositoryIds: string[] = [];

async function insertFixtures() {
    for (const [id, name] of [[ids.repositoryA, `symbol-browser-a-${suffix}`], [ids.repositoryB, `symbol-browser-b-${suffix}`], [ids.emptyRepository, `symbol-browser-empty-${suffix}`]] as const) {
        await pool.query("INSERT INTO repositories(id,name,url) VALUES($1,$2::varchar,$3::text)", [id, name, name]);
        repositoryIds.push(id);
    }
    await pool.query("INSERT INTO files(id,repository_id,path,language) VALUES($1,$2,'src/service.ts','typescript'),($3,$4,'other.ts','typescript')", [ids.fileA, ids.repositoryA, ids.fileB, ids.repositoryB]);
    await pool.query("INSERT INTO symbols(id,repository_id,file_id,name,type,start_line,end_line,signature) VALUES($1,$2,$3,'Service','CLASS',1,12,NULL)", [ids.class, ids.repositoryA, ids.fileA]);
    await pool.query("INSERT INTO symbols(id,repository_id,file_id,name,type,start_line,end_line,parent_symbol_id,signature) VALUES($1,$2,$3,'handlePayment','METHOD',3,8,$4,'handlePayment(id: string)')", [ids.method, ids.repositoryA, ids.fileA, ids.class]);
    await pool.query("INSERT INTO symbols(id,repository_id,file_id,name,type,start_line,end_line,signature) VALUES($1,$2,$3,'formatPayment','FUNCTION',14,17,'formatPayment(payment)')", [ids.function, ids.repositoryA, ids.fileA]);
    await pool.query("INSERT INTO symbols(id,repository_id,file_id,name,type,start_line,end_line) VALUES($1,$2,$3,'ForeignSymbol','METHOD',1,2)", [ids.foreign, ids.repositoryB, ids.fileB]);
    await pool.query("INSERT INTO code_chunks(repository_id,file_id,symbol_id,start_line,end_line,content) VALUES($1,$2,$3,3,8,'function handlePayment(id: string) { return id; }')", [ids.repositoryA, ids.fileA, ids.method]);
}

async function run() {
    await insertFixtures();
    const app = express(); app.use(express.json()); app.use("/api/repositories", repositoryRoutes);
    const server = app.listen(0);
    try {
        await new Promise<void>(resolve => server.once("listening", resolve));
        const address = server.address(); assert.ok(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}/api/repositories`;
        const get = async <T>(repositoryId: string, params = "", status = 200): Promise<T> => {
            const response = await fetch(`${base}/${repositoryId}/query/symbols${params}`, { method: "GET" });
            assert.equal(response.status, status);
            return await response.json() as T;
        };
        const postSymbol = async <T>(repositoryId: string, symbolId: string, status = 200): Promise<T> => {
            const response = await fetch(`${base}/${repositoryId}/query/symbol`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbolId }) });
            assert.equal(response.status, status);
            return await response.json() as T;
        };

        const all = await get<SymbolPage>(ids.repositoryA);
        assert.equal(all.totalCount, 3); assert.equal(all.page, 1); assert.equal(all.pageSize, 50);
        assert.deepEqual(new Set(all.symbols.map(symbol => symbol.type)), new Set(["CLASS", "METHOD", "FUNCTION"]));
        assert.ok(all.symbols.every(symbol => symbol.file.path === "src/service.ts"));
        const methodOnly = await get<SymbolPage>(ids.repositoryA, "?type=METHOD");
        assert.equal(methodOnly.totalCount, 1); assert.equal(methodOnly.symbols[0].name, "handlePayment");
        const nameSearch = await get<SymbolPage>(ids.repositoryA, "?search=payment");
        assert.equal(nameSearch.totalCount, 2);
        const firstPage = await get<SymbolPage>(ids.repositoryA, "?page=1&pageSize=2");
        const secondPage = await get<SymbolPage>(ids.repositoryA, "?page=2&pageSize=2");
        assert.equal(firstPage.symbols.length, 2); assert.equal(secondPage.symbols.length, 1); assert.equal(secondPage.totalPages, 2);
        const invalidType = await get<ApiError>(ids.repositoryA, "?type=PACKAGE", 400);
        assert.equal(invalidType.error.code, "INVALID_REQUEST");
        const invalidPagination = await get<ApiError>(ids.repositoryA, "?page=0&pageSize=500", 400);
        assert.equal(invalidPagination.error.code, "INVALID_REQUEST");
        const empty = await get<SymbolPage>(ids.emptyRepository);
        assert.equal(empty.totalCount, 0); assert.deepEqual(empty.symbols, []);
        const missingRepository = await get<ApiError>(randomUUID(), "", 404);
        assert.equal(missingRepository.error.code, "REPOSITORY_NOT_FOUND");
        const foreignScopedList = await get<SymbolPage>(ids.repositoryA, "?search=ForeignSymbol");
        assert.equal(foreignScopedList.totalCount, 0);
        const foreignDetails = await postSymbol<ApiError>(ids.repositoryA, ids.foreign, 404);
        assert.equal(foreignDetails.error.code, "SYMBOL_NOT_FOUND");
        const details = await postSymbol<SymbolDetails>(ids.repositoryA, ids.method);
        assert.equal(details.name, "handlePayment"); assert.equal(details.parent?.name, "Service");
        assert.equal(details.signature, "handlePayment(id: string)");
        assert.deepEqual(details.sourceContext, { startLine: 3, endLine: 8, content: "function handlePayment(id: string) { return id; }" });
        const noContext = await postSymbol<SymbolDetails>(ids.repositoryA, ids.function);
        assert.equal(noContext.sourceContext, null);
        console.log("Symbol Explorer PostgreSQL/API tests passed: repository isolation, name/type filters, pagination, empty repository, detail metadata, stored source context, and validation.");
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

try { await run(); }
finally {
    for (const repositoryId of repositoryIds) await pool.query("DELETE FROM repositories WHERE id=$1", [repositoryId]);
    await pool.end();
}
