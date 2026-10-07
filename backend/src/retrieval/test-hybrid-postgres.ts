import assert from "node:assert/strict";
import { pool } from "../config/database.js";
import { CodeChunkEmbeddingRepository } from "../embeddings/code-chunk-embedding-repository.js";
import { HybridRetrievalService } from "./hybrid-retrieval-service.js";
import { StructuralRetrievalRepository } from "./structural-retrieval-repository.js";

async function run() {
    const repository = await pool.query<{ id: string }>("SELECT id FROM repositories WHERE name=$1 ORDER BY indexed_at DESC NULLS LAST LIMIT 1", ["Ai-Finance-Controller"]);
    assert.ok(repository.rows[0]);
    const repositoryId = repository.rows[0].id;
    const sample = await pool.query<{ name: string; vector: string }>(
        `SELECT s.name, c.embedding::text AS vector FROM code_chunks c
         JOIN symbols s ON s.id=c.symbol_id AND s.repository_id=c.repository_id AND s.file_id=c.file_id
         WHERE c.repository_id=$1 AND c.embedding IS NOT NULL ORDER BY c.id LIMIT 1`, [repositoryId]);
    assert.ok(sample.rows[0]);
    const vector = JSON.parse(sample.rows[0].vector) as number[];
    const service = new HybridRetrievalService(new CodeChunkEmbeddingRepository(), { async embedQuery() { return vector; } }, new StructuralRetrievalRepository());
    const result = await service.retrieve(repositoryId, sample.rows[0].name, { topK: 3, maxDepth: 1 });
    assert.ok(result.semantic.length > 0);
    assert.ok(result.semantic.every(chunk => chunk.repositoryId === repositoryId));
    assert.ok(result.evidence.length > 0);
    assert.ok(result.evidence.every(item => item.repositoryId === repositoryId));
    assert.ok(result.relationships.every(edge => edge.source.repositoryId === repositoryId && edge.target.repositoryId === repositoryId));
    console.log(JSON.stringify({ repositoryId, query: sample.rows[0].name, semanticCount: result.semantic.length,
        structuralSymbolCount: result.symbols.length, relationshipCount: result.relationships.length,
        evidenceCount: result.evidence.length, sample: result.evidence.slice(0, 3).map(item => ({ provenance: item.provenance,
            filePath: item.filePath, symbol: item.symbol, startLine: item.startLine, endLine: item.endLine, kind: item.kind })) }));
}

try { await run(); } finally { await pool.end(); }
