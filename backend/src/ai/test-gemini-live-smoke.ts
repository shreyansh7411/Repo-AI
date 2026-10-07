import { pool } from "../config/database.js";
import { GeminiLLMProvider } from "./gemini-llm-provider.js";
import { buildGroundedPrompt } from "../retrieval/grounded-prompt.js";
import type { Evidence } from "../retrieval/types.js";

async function run() {
    console.log(`GEMINI_API_KEY configured: ${process.env.GEMINI_API_KEY?.trim() ? "yes" : "no"}`);
    const row = await pool.query<{ repositoryId: string; filePath: string; symbol: string | null; symbolType: string | null; startLine: number; endLine: number; content: string }>(
        `SELECT c.repository_id AS "repositoryId", f.path AS "filePath", s.name AS symbol,
                s.type AS "symbolType", c.start_line AS "startLine", c.end_line AS "endLine", c.content
         FROM code_chunks c JOIN files f ON f.id=c.file_id AND f.repository_id=c.repository_id
         LEFT JOIN symbols s ON s.id=c.symbol_id AND s.repository_id=c.repository_id AND s.file_id=c.file_id
         WHERE c.repository_id=(SELECT id FROM repositories WHERE name=$1 ORDER BY indexed_at DESC NULLS LAST LIMIT 1)
         ORDER BY c.id LIMIT 1`, ["Ai-Finance-Controller"]);
    const chunk = row.rows[0];
    if (!chunk) throw new Error("No repository evidence is available for the Gemini smoke test.");
    const evidence: Evidence = { id: "smoke:repository-evidence", kind: "CHUNK", provenance: "SEMANTIC",
        repositoryId: chunk.repositoryId, filePath: chunk.filePath, symbolId: null, symbol: chunk.symbol,
        symbolType: chunk.symbolType, startLine: chunk.startLine, endLine: chunk.endLine, content: chunk.content, score: 1 };
    const question = "What does the supplied code directly show?";
    const prompt = buildGroundedPrompt(question, [evidence], `[${evidence.id}] ${evidence.filePath}:${evidence.startLine}-${evidence.endLine}\n${evidence.content}`);
    const answer = await new GeminiLLMProvider().generateAnswer(prompt);
    console.log(JSON.stringify({ success: true, answer: answer.slice(0, 800), evidenceFile: evidence.filePath,
        startLine: evidence.startLine, endLine: evidence.endLine }));
}

try { await run(); }
catch (error) { console.error(error instanceof Error ? error.message : "Gemini reasoning smoke test failed."); process.exitCode = 1; }
finally { await pool.end(); }
