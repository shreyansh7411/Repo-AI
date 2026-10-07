import assert from "node:assert/strict";
import { GeminiLLMProvider } from "./gemini-llm-provider.js";

async function run() {
    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "unit-test-secret";
    let requestBody: Record<string, unknown> | undefined;
    const provider = new GeminiLLMProvider(async (_url, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "grounded" }] } }] }), { status: 200 });
    });
    try {
        assert.equal(await provider.generateAnswer({ systemInstruction: "Ground", prompt: "Evidence" }), "grounded");
        assert.equal(requestBody?.system_instruction !== undefined, true);
        let permanentAttempts = 0;
        const failing = new GeminiLLMProvider(async () => {
            permanentAttempts++;
            return new Response(JSON.stringify({ error: { message: "bad unit-test-secret token" } }), { status: 403 });
        });
        await assert.rejects(() => failing.generateAnswer({ systemInstruction: "", prompt: "" }), error => {
            assert.equal(String(error).includes("unit-test-secret"), false);
            assert.match(String(error), /\[redacted\]/);
            return true;
        });
        assert.equal(permanentAttempts, 1, "permanent errors should not be retried");
        let transientAttempts = 0;
        const retrying = new GeminiLLMProvider(async () => {
            transientAttempts++;
            return transientAttempts === 1
                ? new Response(JSON.stringify({ error: { message: "temporary overload" } }), { status: 503 })
                : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "recovered" }] } }] }), { status: 200 });
        });
        assert.equal(await retrying.generateAnswer({ systemInstruction: "", prompt: "" }), "recovered");
        assert.equal(transientAttempts, 2, "temporary server failures should be retried within the bound");
    } finally {
        if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = originalKey;
    }
    console.log("Gemini LLM provider tests passed: request format, response extraction, API error handling, and secret redaction.");
}

await run();
