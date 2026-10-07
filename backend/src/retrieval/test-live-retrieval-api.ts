import express from "express";
import repositoryRoutes from "../ingestion/repository-routes.js";
import { pool } from "../config/database.js";

async function run() {
    const app = express();
    app.use(express.json());
    app.use("/api/repositories", repositoryRoutes);
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not start retrieval test server.");
    const repo = await pool.query<{ id: string }>("SELECT id FROM repositories WHERE name=$1 ORDER BY indexed_at DESC NULLS LAST LIMIT 1", ["Ai-Finance-Controller"]);
    if (!repo.rows[0]) throw new Error("Ai-Finance-Controller is not indexed.");
    console.log(`GEMINI_API_KEY configured: ${process.env.GEMINI_API_KEY?.trim() ? "yes" : "no"}`);
    const questions = ["How does payment reconciliation work?", "How are refunds handled?", "Where are financial exceptions resolved?", "How are settlement records processed?", "Where is authentication implemented?"];
    try {
        for (const query of questions) {
            const response = await fetch(`http://127.0.0.1:${address.port}/api/repositories/${repo.rows[0].id}/retrieve`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, limit: 5, maxDepth: 1 })
            });
            const result = await response.json() as {
                semantic?: Array<{ filePath: string; symbolName: string | null; startLine: number; endLine: number; similarity: number; content: string }>;
                symbols?: Array<{ filePath: string; name: string; startLine: number; endLine: number }>;
                relationships?: Array<{ type: string; source: { name: string }; target: { name: string } }>;
                evidence?: Array<{ provenance: string; kind: string; filePath: string; symbol: string | null; startLine: number; endLine: number }>;
                semanticError?: string; error?: string;
            };
            console.log(JSON.stringify({ query, status: response.status, semantic: result.semantic?.slice(0, 3).map(item => ({ file: item.filePath,
                symbol: item.symbolName, lines: `${item.startLine}-${item.endLine}`, similarity: Number(item.similarity.toFixed(4)),
                excerpt: item.content.slice(0, 180) })), structuralSymbols: result.symbols?.slice(0, 5).map(item => ({ file: item.filePath,
                symbol: item.name, lines: `${item.startLine}-${item.endLine}` })), relationships: result.relationships?.slice(0, 5).map(edge => `${edge.source.name} --${edge.type}--> ${edge.target.name}`),
                mergedEvidence: result.evidence?.slice(0, 5).map(item => ({ source: item.provenance, kind: item.kind, file: item.filePath,
                    symbol: item.symbol, lines: `${item.startLine}-${item.endLine}` })), semanticError: result.semanticError, error: result.error }));
        }
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

try { await run(); }
catch (error) { console.error(error instanceof Error ? error.message : "Live retrieval API verification failed."); process.exitCode = 1; }
finally { await pool.end(); }
