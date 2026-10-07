import assert from "node:assert/strict";
import type { SearchChunk } from "../embeddings/types.js";
import { CodeChunkEmbeddingRepository } from "../embeddings/code-chunk-embedding-repository.js";
import { StructuralRetrievalRepository } from "./structural-retrieval-repository.js";
import { HybridRetrievalService } from "./hybrid-retrieval-service.js";
import type { StructuralRelationship, StructuralSymbol } from "./types.js";

const repo = "00000000-0000-4000-8000-000000000001";
const file = "00000000-0000-4000-8000-000000000002";
const source: StructuralSymbol = { id: "00000000-0000-4000-8000-000000000003", repositoryId: repo, fileId: file, filePath: "src/a.ts", name: "reconcile", symbolType: "FUNCTION", startLine: 1, endLine: 4, signature: "function reconcile()" };
const target: StructuralSymbol = { ...source, id: "00000000-0000-4000-8000-000000000004", name: "save", startLine: 6, endLine: 8 };
const edge: StructuralRelationship = { id: "00000000-0000-4000-8000-000000000005", type: "CALLS", source, target };
const semanticChunk: SearchChunk = { id: "chunk-1", repositoryId: repo, fileId: file, filePath: "src/a.ts", symbolId: source.id, symbolName: source.name, symbolType: source.symbolType, startLine: 1, endLine: 4, content: "function reconcile() { save(); }", similarity: 0.9 };

class FakeChunks extends CodeChunkEmbeddingRepository {
    async search(repositoryId: string): Promise<SearchChunk[]> { assert.equal(repositoryId, repo); return [semanticChunk]; }
}
class FakeGraph extends StructuralRetrievalRepository {
    async findMatchingSymbols(repositoryId: string): Promise<StructuralSymbol[]> { assert.equal(repositoryId, repo); return [source]; }
    async expand(repositoryId: string, ids: string[], depth: number) {
        assert.equal(repositoryId, repo); assert.deepEqual(ids, [source.id]); assert.equal(depth, 1);
        return { symbols: [source, target], relationships: [edge] };
    }
    async getSymbolChunks(repositoryId: string, ids: string[]) {
        assert.equal(repositoryId, repo); assert.deepEqual(ids.sort(), [source.id, target.id].sort());
        return [{ id: "chunk-1", filePath: "src/a.ts", symbolId: source.id, symbolName: source.name,
            symbolType: source.symbolType, startLine: 1, endLine: 4, content: semanticChunk.content },
            { id: "chunk-2", filePath: "src/a.ts", symbolId: target.id, symbolName: target.name,
                symbolType: target.symbolType, startLine: 6, endLine: 8, content: "function save() {}" }];
    }
}

async function run() {
    let embedCalls = 0;
    const service = new HybridRetrievalService(new FakeChunks(), { async embedQuery() { embedCalls++; return [1]; } }, new FakeGraph(), 2000);
    const result = await service.retrieve(repo, "reconcile", { topK: 4, maxDepth: 1 });
    assert.equal(embedCalls, 1);
    assert.equal(result.semantic.length, 1);
    assert.equal(result.relationships.length, 1);
    assert.equal(result.evidence.find(item => item.id === "chunk:chunk-1")?.provenance, "BOTH");
    assert.equal(result.evidence.some(item => item.content === "reconcile --CALLS--> save"), true);
    assert.equal(result.context.includes("src/a.ts:1-4"), true);
    assert.equal(result.context.length <= 2000, true);
    assert.equal(result.evidence[0].score >= result.evidence.at(-1)!.score, true);
    const bounded = new HybridRetrievalService(new FakeChunks(), { async embedQuery() { return [1]; } }, new FakeGraph(), 1000);
    await assert.rejects(() => bounded.retrieve(repo, "reconcile", { maxDepth: 3 }), /maxDepth/);
    const fallback = new HybridRetrievalService(new FakeChunks(), { async embedQuery() { throw new Error("Gemini query quota exceeded."); } }, new FakeGraph());
    const fallbackResult = await fallback.retrieve(repo, "reconcile", { topK: 4, maxDepth: 1 });
    assert.equal(fallbackResult.semantic.length, 0);
    assert.match(fallbackResult.semanticError ?? "", /quota/);
    assert.equal(fallbackResult.evidence.length > 0, true, "direct structural matches remain available when query embedding fails");
    console.log("Hybrid retrieval tests passed: semantic start, bounded graph expansion, provenance deduplication, deterministic ranking, context budget, repository scope, and structural fallback.");
}

await run();
