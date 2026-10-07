import assert from "node:assert/strict";
import { GeminiEmbeddingProvider } from "./gemini-embedding-provider.js";
import { EMBEDDING_DIMENSIONS } from "./types.js";

async function run() {
    let calls = 0;
    const startedAt = Date.now();
    const requestBodies: Array<{ requests: Array<{ model: string; content: { parts: Array<{ text: string }> }; embedContentConfig: { outputDimensionality: number } }> }> = [];
    const provider = new GeminiEmbeddingProvider({
        apiKey: "unit-test-key",
        fetchImpl: async (_input, init) => {
            calls++;
            assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "unit-test-key");
            const body = JSON.parse(String(init?.body)) as typeof requestBodies[number];
            requestBodies.push(body);
            if (calls === 1) return new Response(JSON.stringify({ error: { message: "rate limited; retry in 0.01s" } }), { status: 429 });
            return new Response(JSON.stringify({ embeddings: body.requests.map(() => ({ values: Array(384).fill(0.25) })) }), { status: 200 });
        }
    });

    const [documentVector] = await provider.embedBatch(["File: example.ts\n\nsource"], "document");
    assert.equal(calls, 2, "HTTP 429 is retried once before succeeding");
    assert.ok(Date.now() - startedAt >= 450, "provider observes a retry-after hint");
    assert.equal(documentVector.length, EMBEDDING_DIMENSIONS);
    const documentRequest = requestBodies[1].requests[0];
    assert.equal(documentRequest.model, "models/gemini-embedding-2");
    assert.equal(documentRequest.embedContentConfig.outputDimensionality, EMBEDDING_DIMENSIONS);
    assert.match(documentRequest.content.parts[0].text, /^title: code chunk \| text:/);

    await provider.embedBatch(["how does code retrieval work?"], "query");
    assert.match(requestBodies[2].requests[0].content.parts[0].text, /^task: code retrieval \| query:/);

    let badRequestCalls = 0;
    const invalidKeyProvider = new GeminiEmbeddingProvider({
        apiKey: "unit-test-key",
        fetchImpl: async () => {
            badRequestCalls++;
            return new Response(JSON.stringify({ error: { message: "bad unit-test-key credential" } }), { status: 400 });
        }
    });
    await assert.rejects(async () => invalidKeyProvider.embedBatch(["bad"]), error => {
        assert.match(String(error), /HTTP 400/);
        assert.doesNotMatch(String(error), /unit-test-key/);
        return true;
    });
    assert.equal(badRequestCalls, 1, "invalid requests are not retried");

    let exhaustedQuotaCalls = 0;
    const exhaustedQuota = new GeminiEmbeddingProvider({
        apiKey: "unit-test-key",
        fetchImpl: async () => {
            exhaustedQuotaCalls++;
            return new Response(JSON.stringify({ error: { message: "quota exceeded; retry in 8h31m47.25s" } }), { status: 429 });
        }
    });
    await assert.rejects(() => exhaustedQuota.embedBatch(["quota test"]), /retry in 8h31m47/);
    assert.equal(exhaustedQuotaCalls, 1, "long quota reset windows are surfaced without repeated requests");
    console.log("Gemini provider request, 384D configuration, task formatting, transient retry, and secret redaction tests passed.");
}

await run();
