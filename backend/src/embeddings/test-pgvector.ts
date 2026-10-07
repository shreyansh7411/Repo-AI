import assert from "node:assert/strict";
import { pool } from "../config/database.js";
import { CodeChunkEmbeddingRepository } from "./code-chunk-embedding-repository.js";
import { EmbeddingService } from "./embedding-service.js";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "./types.js";

const unit = (index: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i === index ? 1 : 0);

const mockProvider: EmbeddingProvider = {
    async embedBatch(texts) {
        return texts.map(text => unit(text.includes("nearest") ? 0 : text.includes("orthogonal") || text.includes("far") ? 1 : 2));
    }
};

async function run() {
    const a = await pool.query<{ id: string }>("INSERT INTO repositories (name, url) VALUES ('embedding-test-a', 'embedding-test-a') RETURNING id");
    const b = await pool.query<{ id: string }>("INSERT INTO repositories (name, url) VALUES ('embedding-test-b', 'embedding-test-b') RETURNING id");
    const repoA = a.rows[0].id;
    const repoB = b.rows[0].id;
    try {
        const fa = await pool.query<{ id: string }>("INSERT INTO files(repository_id,path,language) VALUES ($1,'a.ts','typescript') RETURNING id", [repoA]);
        const fb = await pool.query<{ id: string }>("INSERT INTO files(repository_id,path,language) VALUES ($1,'b.ts','typescript') RETURNING id", [repoB]);
        const insert = async (repo: string, file: string, content: string) => pool.query<{ id: string }>(
            "INSERT INTO code_chunks(repository_id,file_id,start_line,end_line,content) VALUES ($1,$2,1,1,$3) RETURNING id", [repo, file, content]);
        const near = await insert(repoA, fa.rows[0].id, "nearest");
        const far = await insert(repoA, fa.rows[0].id, "orthogonal");
        const isolated = await insert(repoB, fb.rows[0].id, "other repository");
        const missing = await insert(repoA, fa.rows[0].id, "missing embedding");
        const repository = new CodeChunkEmbeddingRepository();
        assert.equal(await repository.saveEmbeddings(repoA, [
            { id: near.rows[0].id, embedding: unit(0) },
            { id: far.rows[0].id, embedding: unit(1) },
            { id: isolated.rows[0].id, embedding: unit(0) }
        ]), 2, "repository scope prevents writing a foreign chunk");
        const results = await repository.search(repoA, unit(0), 10);
        assert.deepEqual(results.map(result => result.id), [near.rows[0].id, far.rows[0].id]);
        assert.equal(Number(results[0].similarity.toFixed(5)), 1);
        assert.equal(results.some(result => result.id === isolated.rows[0].id), false);
        assert.equal(results.some(result => result.id === missing.rows[0].id), false);
        assert.deepEqual(await repository.countEmbeddings(repoA), { total: 3, embedded: 2, missing: 1 });
        assert.equal(await repository.saveEmbeddings(repoA, [{ id: near.rows[0].id, embedding: unit(2) }]), 0,
            "generation is idempotent and does not overwrite a saved embedding");
        assert.equal(await repository.clearEmbeddings(repoA), 2);
        assert.deepEqual(await repository.countEmbeddings(repoA), { total: 3, embedded: 0, missing: 3 });

        await insert(repoA, fa.rows[0].id, "generated nearest");
        await insert(repoA, fa.rows[0].id, "generated far");
        const service = new EmbeddingService(repository, mockProvider, 2);
        const generated = await service.generateMissing(repoA);
        assert.equal(generated.created, 5, "mock-provider generation persists vectors in multiple database batches");
        assert.equal(generated.failed, 0);
        const repeated = await service.generateMissing(repoA);
        assert.deepEqual({ processed: repeated.processed, created: repeated.created }, { processed: 0, created: 0 });
        const semanticResults = await repository.search(repoA, await service.embedQuery("nearest query"), 10);
        assert.equal(Number(semanticResults[0].similarity.toFixed(5)), 1);
        assert.equal(semanticResults.some(result => result.id === near.rows[0].id), true);
        assert.equal(semanticResults.some(result => result.content === "generated nearest"), true);
        assert.equal((await repository.countEmbeddings(repoA)).embedded, 5);
        console.log("pgvector generation, batch persistence, cosine ordering, repeat idempotency, NULL exclusion, and repository isolation tests passed.");
    } finally {
        await pool.query("DELETE FROM repositories WHERE id = ANY($1::uuid[])", [[repoA, repoB]]);
        await pool.end();
    }
}

await run();
