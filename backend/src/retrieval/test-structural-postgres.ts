import assert from "node:assert/strict";
import { pool } from "../config/database.js";
import { StructuralRetrievalRepository } from "./structural-retrieval-repository.js";
import { randomUUID } from "node:crypto";

async function run() {
    const repo = await pool.query<{ id: string }>("SELECT id FROM repositories WHERE name=$1 ORDER BY indexed_at DESC NULLS LAST LIMIT 1", ["Ai-Finance-Controller"]);
    assert.ok(repo.rows[0], "production repository should be indexed");
    const repositoryId = repo.rows[0].id;
    const seed = await pool.query<{ id: string }>("SELECT source_symbol_id AS id FROM relationships WHERE repository_id=$1 ORDER BY id LIMIT 1", [repositoryId]);
    assert.ok(seed.rows[0], "repository should have graph edges");
    const repository = new StructuralRetrievalRepository();
    const empty = await repository.expand(repositoryId, [seed.rows[0].id], 0);
    assert.deepEqual(empty, { symbols: [], relationships: [] });
    const graph = await repository.expand(repositoryId, [seed.rows[0].id], 1);
    assert.ok(graph.relationships.length > 0);
    assert.ok(graph.symbols.length >= 2);
    assert.ok(graph.symbols.every(symbol => symbol.repositoryId === repositoryId));
    assert.ok(graph.relationships.every(edge => edge.source.repositoryId === repositoryId && edge.target.repositoryId === repositoryId));
    assert.ok(graph.relationships.every(edge => ["CALLS", "EXTENDS", "IMPLEMENTS", "IMPORTS"].includes(edge.type)));
    const name = `milestone5-cycle-${randomUUID()}`;
    const fixtureRepo = await pool.query<{ id: string }>("INSERT INTO repositories(name,url) VALUES($1::varchar,$1::text) RETURNING id", [name]);
    const fixtureId = fixtureRepo.rows[0].id;
    try {
        const file = await pool.query<{ id: string }>("INSERT INTO files(repository_id,path,language) VALUES($1,'cycle.ts','typescript') RETURNING id", [fixtureId]);
        const symbolIds: string[] = [];
        for (const [index, symbolName] of ["alpha", "beta", "gamma"].entries()) {
            const inserted = await pool.query<{ id: string }>(
                "INSERT INTO symbols(repository_id,file_id,name,type,start_line,end_line) VALUES($1,$2,$3,'FUNCTION',$4,$4) RETURNING id",
                [fixtureId, file.rows[0].id, symbolName, index + 1]);
            symbolIds.push(inserted.rows[0].id);
        }
        await pool.query("INSERT INTO relationships(repository_id,source_symbol_id,target_symbol_id,type) VALUES($1,$2,$3,'CALLS'),($1,$3,$2,'CALLS'),($1,$3,$4,'CALLS')",
            [fixtureId, symbolIds[0], symbolIds[1], symbolIds[2]]);
        const depthOne = await repository.expand(fixtureId, [symbolIds[0]], 1);
        assert.equal(depthOne.symbols.length, 2, "depth one must not follow beta to gamma");
        assert.equal(depthOne.relationships.length, 2, "both directions between the cycle nodes are retained");
        const depthTwo = await repository.expand(fixtureId, [symbolIds[0]], 2);
        assert.equal(depthTwo.symbols.length, 3, "depth two reaches gamma despite the cycle");
        assert.equal(depthTwo.relationships.length, 3, "each graph edge appears once despite the cycle");
        const isolated = await repository.expand(repositoryId, [symbolIds[0]], 2);
        assert.deepEqual(isolated, { symbols: [], relationships: [] }, "foreign repository IDs are excluded");
    } finally {
        await pool.query("DELETE FROM repositories WHERE id=$1", [fixtureId]);
    }
    console.log(`PostgreSQL structural retrieval passed: production graph scope plus bounded depth, cycle handling, and repository isolation fixture.`);
}

try { await run(); } finally { await pool.end(); }
