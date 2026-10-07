import assert from "node:assert/strict";
import { AssistantService } from "./assistant-service.js";
import type { HybridRetrievalService } from "./hybrid-retrieval-service.js";
import { buildGroundedPrompt, GROUNDING_INSTRUCTIONS } from "./grounded-prompt.js";
import type { Evidence, RetrievalResult } from "./types.js";

const evidence: Evidence = { id: "chunk:abc", kind: "CHUNK", provenance: "BOTH", repositoryId: "repo", filePath: "src/payments.ts", symbolId: "sym", symbol: "reconcile", symbolType: "FUNCTION", startLine: 10, endLine: 16, content: "return settle();", score: 1 };
const retrievalResult: RetrievalResult = { repositoryId: "repo", query: "reconcile", semantic: [], symbols: [], relationships: [], evidence: [evidence], context: "evidence", contextChars: 8, truncated: false };

async function run() {
    const prompt = buildGroundedPrompt("question", [evidence], "evidence");
    assert.match(prompt.systemInstruction, /only the repository evidence/);
    assert.match(prompt.systemInstruction, /do not write file paths or line numbers yourself/i);
    assert.match(prompt.systemInstruction, /Do not invent files/);
    assert.match(prompt.prompt, /question/);
    let calls = 0, captured = "";
    const retrieval = { async retrieve() { return retrievalResult; } } as unknown as HybridRetrievalService;
    const service = new AssistantService(retrieval, { async generateAnswer(input) { calls++; captured = input.systemInstruction + input.prompt; return "Supported answer [chunk:abc]. Unsupported: [chunk:deadbeef] backend/src/fake.java:1-3"; } });
    const answer = await service.ask("repo", "reconcile");
    assert.match(answer.answer, /Supported answer \[chunk:abc\]/);
    assert.equal(answer.answer.includes("deadbeef"), false);
    assert.equal(answer.answer.includes("fake.java"), false);
    assert.match(answer.answer, /Verified sources:/);
    assert.match(answer.answer, /src\/payments\.ts:10-16/);
    assert.deepEqual(answer.citations, [{ filePath: "src/payments.ts", startLine: 10, endLine: 16, symbol: "reconcile", evidenceId: "chunk:abc" }]);
    assert.match(captured, /only the repository evidence/);
    assert.equal(calls, 1);
    const noEvidenceRetrieval = { async retrieve() { return { ...retrievalResult, evidence: [] }; } } as unknown as HybridRetrievalService;
    const noEvidence = await new AssistantService(noEvidenceRetrieval, { async generateAnswer() { calls++; return "should not run"; } }).ask("repo", "unknown");
    assert.equal(noEvidence.insufficientEvidence, true);
    assert.equal(calls, 1, "LLM must not be called for empty evidence");
    assert.match(GROUNDING_INSTRUCTIONS, /Distinguish directly supported facts from inference/);
    console.log("Assistant tests passed: grounding prompt, trusted app citations, mocked LLM, and no-evidence short circuit.");
}

await run();
