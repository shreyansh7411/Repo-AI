import { pool } from "../config/database.js";
import { GeminiLLMProvider } from "../ai/gemini-llm-provider.js";
import { CodeChunkEmbeddingRepository } from "../embeddings/code-chunk-embedding-repository.js";
import { EmbeddingService } from "../embeddings/embedding-service.js";
import { GeminiEmbeddingProvider } from "../embeddings/gemini-embedding-provider.js";
import { AssistantService } from "./assistant-service.js";
import { HybridRetrievalService } from "./hybrid-retrieval-service.js";
import { StructuralRetrievalRepository } from "./structural-retrieval-repository.js";

async function run() {
    console.log(`GEMINI_API_KEY configured: ${process.env.GEMINI_API_KEY?.trim() ? "yes" : "no"}`);
    const repo = await pool.query<{ id: string }>("SELECT id FROM repositories WHERE name=$1 ORDER BY indexed_at DESC NULLS LAST LIMIT 1", ["Ai-Finance-Controller"]);
    if (!repo.rows[0]) throw new Error("Ai-Finance-Controller is not indexed.");
    const chunks = new CodeChunkEmbeddingRepository();
    const retrieval = new HybridRetrievalService(chunks, new EmbeddingService(chunks, new GeminiEmbeddingProvider()), new StructuralRetrievalRepository(), 6000);
    const assistant = new AssistantService(retrieval, new GeminiLLMProvider());
    const questions = ["How does payment reconciliation work?", "How are refunds handled?", "Where are financial exceptions resolved?"];
    const requestedQuestions = process.argv.includes("--first-only") ? questions.slice(0, 1) : questions;
    for (const question of requestedQuestions) {
        try {
            const result = await assistant.ask(repo.rows[0].id, question, { topK: 3, maxDepth: 1 });
            console.log(JSON.stringify({ question, answer: result.answer.slice(0, 1800), semanticAvailable: result.semanticAvailable,
                citations: result.citations.slice(0, 8), evidenceCount: result.evidence.length,
                evidenceProvenance: [...new Set(result.evidence.map(item => item.provenance))], insufficientEvidence: result.insufficientEvidence }));
        } catch (error) {
            console.log(JSON.stringify({ question, error: error instanceof Error ? error.message : "Ask failed." }));
        }
    }
}

try { await run(); }
catch (error) { console.error(error instanceof Error ? error.message : "Live ask verification failed."); process.exitCode = 1; }
finally { await pool.end(); }
