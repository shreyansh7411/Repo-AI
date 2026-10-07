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
    if (!address || typeof address === "string") throw new Error("Could not start ask API test server.");
    const repo = await pool.query<{ id: string }>("SELECT id FROM repositories WHERE name=$1 ORDER BY indexed_at DESC NULLS LAST LIMIT 1", ["Ai-Finance-Controller"]);
    if (!repo.rows[0]) throw new Error("Ai-Finance-Controller is not indexed.");
    console.log(`GEMINI_API_KEY configured: ${process.env.GEMINI_API_KEY?.trim() ? "yes" : "no"}`);
    try {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/repositories/${repo.rows[0].id}/ask`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: "How does payment reconciliation work?", topK: 3, maxDepth: 1 })
        });
        const result = await response.json() as { answer?: string; citations?: Array<{ filePath: string; startLine: number; endLine: number }>;
            semanticAvailable?: boolean; insufficientEvidence?: boolean; error?: string };
        console.log(JSON.stringify({ status: response.status, answer: result.answer?.slice(0, 1300),
            citations: result.citations, semanticAvailable: result.semanticAvailable,
            insufficientEvidence: result.insufficientEvidence, error: result.error }));
        if (!response.ok) throw new Error(`Ask endpoint returned HTTP ${response.status}.`);
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

try { await run(); }
catch (error) { console.error(error instanceof Error ? error.message : "Live ask API verification failed."); process.exitCode = 1; }
finally { await pool.end(); }
