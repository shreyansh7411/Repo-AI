import assert from "node:assert/strict";
import express from "express";
import { pool } from "../config/database.js";
import repositoryRoutes from "../ingestion/repository-routes.js";

const repositoryId = "d99205ac-705c-4fc5-bd44-47cc7db1973b";

async function run() {
    const app = express(); app.use(express.json()); app.use("/api/repositories", repositoryRoutes);
    const server = app.listen(0);
    try {
        await new Promise<void>(resolve => server.once("listening", resolve));
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const url = `http://127.0.0.1:${address.port}/api/repositories/${repositoryId}/query/search`;
        const request = async (mode: "semantic" | "hybrid") => {
            const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ query: "How does payment reconciliation work?", mode, topK: 5, maxDepth: 1 }) });
            assert.equal(response.status, 200, `${mode} query endpoint status`);
            return await response.json() as { mode: string; semanticAvailable: boolean | null; semanticError?: string; evidence: Array<{ source: string; kind: string; file: { path: string }; startLine: number; endLine: number; similarity?: number }> };
        };
        const semantic = await request("semantic");
        const hybrid = await request("hybrid");
        for (const [label, result] of [["semantic", semantic], ["hybrid", hybrid]] as const) {
            assert.equal(result.mode, label);
            if (result.semanticAvailable === false) {
                assert.match(result.semanticError ?? "", /upstream HTTP 403|unavailable/i);
                assert.ok(result.evidence.every(item => item.source === "STRUCTURAL"), `${label} fallback evidence must be structural`);
            }
        }
        const graph = await pool.query<{ type: string; count: string }>(
            "SELECT type, COUNT(*)::text AS count FROM relationships WHERE repository_id=$1 GROUP BY type ORDER BY type", [repositoryId]);
        const duplicate = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM (
                SELECT repository_id,source_symbol_id,target_symbol_id,type FROM relationships
                WHERE repository_id=$1 GROUP BY repository_id,source_symbol_id,target_symbol_id,type HAVING COUNT(*)>1
             ) duplicates`, [repositoryId]);
        const crossRepository = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM relationships r
             JOIN symbols s ON s.id=r.source_symbol_id JOIN symbols t ON t.id=r.target_symbol_id
             WHERE r.repository_id=$1 AND (s.repository_id<>r.repository_id OR t.repository_id<>r.repository_id)`, [repositoryId]);
        const counts = { CALLS: 0, EXTENDS: 0, IMPLEMENTS: 0, IMPORTS: 0 };
        for (const row of graph.rows) if (row.type in counts) counts[row.type as keyof typeof counts] = Number(row.count);
        assert.deepEqual(counts, { CALLS: 402, EXTENDS: 0, IMPLEMENTS: 5, IMPORTS: 366 });
        assert.equal(Number(duplicate.rows[0].count), 0);
        assert.equal(Number(crossRepository.rows[0].count), 0);
        console.log(JSON.stringify({ repositoryId, semantic: { available: semantic.semanticAvailable, semanticError: semantic.semanticError ?? null,
            evidenceCount: semantic.evidence.length, sample: semantic.evidence.slice(0, 3) },
            hybrid: { available: hybrid.semanticAvailable, semanticError: hybrid.semanticError ?? null,
                evidenceCount: hybrid.evidence.length, sample: hybrid.evidence.slice(0, 3) },
            graph: { counts, total: Object.values(counts).reduce((total, value) => total + value, 0), duplicates: Number(duplicate.rows[0].count), crossRepository: Number(crossRepository.rows[0].count) } }));
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

try { await run(); }
finally { await pool.end(); }
