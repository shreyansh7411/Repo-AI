import assert from "node:assert/strict";
import { CodeChunkEmbeddingRepository } from "./code-chunk-embedding-repository.js";
import { EmbeddingService } from "./embedding-service.js";
import { EMBEDDING_DIMENSIONS, type EmbeddingChunk, type EmbeddingProvider } from "./types.js";

class MemoryRepository extends CodeChunkEmbeddingRepository {
    missing: EmbeddingChunk[];
    saved: Array<{ id: string; embedding: number[] }> = [];
    constructor(chunks: EmbeddingChunk[]) { super(); this.missing = chunks; }
    override async getMissingEmbeddings(): Promise<EmbeddingChunk[]> { return this.missing; }
    override async saveEmbeddings(_repo: string, rows: Array<{ id: string; embedding: number[] }>): Promise<number> {
        this.saved.push(...rows);
        this.missing = [];
        return rows.length;
    }
}

const chunk: EmbeddingChunk = {
    id: "chunk-1", repositoryId: "repo-1", fileId: "file-1", filePath: "src/pay.ts",
    symbolId: "symbol-1", symbolName: "pay", symbolType: "FUNCTION",
    startLine: 1, endLine: 2, content: "export function pay() {}"
};

class MockProvider implements EmbeddingProvider {
    fail = false;
    inputs: string[][] = [];
    async embedBatch(texts: string[]): Promise<number[][]> {
        this.inputs.push(texts);
        if (this.fail) throw new Error("temporary provider failure");
        return texts.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0));
    }
}

async function run() {
    const repository = new MemoryRepository([chunk]);
    const provider = new MockProvider();
    const service = new EmbeddingService(repository, provider);
    const generated = await service.generateMissing("repo-1");
    assert.deepEqual({ processed: generated.processed, created: generated.created, failed: generated.failed },
        { processed: 1, created: 1, failed: 0 });
    assert.match(provider.inputs[0][0], /File: src\/pay.ts[\s\S]*Symbol: pay[\s\S]*export function pay/);
    assert.equal(repository.saved[0].embedding.length, EMBEDDING_DIMENSIONS);
    assert.deepEqual(await service.embedQuery("payment"), repository.saved[0].embedding);

    const failingRepository = new MemoryRepository([chunk]);
    const failingProvider = new MockProvider();
    failingProvider.fail = true;
    const retryableService = new EmbeddingService(failingRepository, failingProvider);
    const failed = await retryableService.generateMissing("repo-1");
    assert.equal(failed.failed, 1);
    assert.equal(failingRepository.saved.length, 0, "failed provider batch must not partially persist vectors");
    failingProvider.fail = false;
    assert.equal((await retryableService.generateMissing("repo-1")).created, 1, "NULL vector should be retryable");

    const invalidProvider: EmbeddingProvider = { embedBatch: async () => [Array(383).fill(0)] };
    const invalidService = new EmbeddingService(new MemoryRepository([chunk]), invalidProvider);
    await assert.rejects(() => invalidService.embedQuery("bad vector"), /exactly 384/);
    const zeroProvider: EmbeddingProvider = { embedBatch: async () => [Array(384).fill(0)] };
    await assert.rejects(() => new EmbeddingService(new MemoryRepository([chunk]), zeroProvider).embedQuery("zero"), /zero vector/);
    console.log("Embedding service tests passed.");
}

await run();
