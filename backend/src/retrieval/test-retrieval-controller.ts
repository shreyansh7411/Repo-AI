import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { askHandler, retrieveHandler } from "./retrieval-controller.js";

function fakeResponse() {
    let statusCode = 200;
    let payload: unknown;
    const response = {
        status(code: number) { statusCode = code; return response; },
        json(body: unknown) { payload = body; return response; }
    } as unknown as Response;
    return { response, status: () => statusCode, payload: () => payload };
}

async function run() {
    const invalidId = fakeResponse();
    await askHandler({ params: { repositoryId: "bad" }, body: { question: "hello" } } as unknown as Request, invalidId.response);
    assert.equal(invalidId.status(), 400);
    const emptyAsk = fakeResponse();
    await askHandler({ params: { repositoryId: "d99205ac-705c-4fc5-bd44-47cc7db1973b" }, body: { question: " " } } as unknown as Request, emptyAsk.response);
    assert.equal(emptyAsk.status(), 400);
    const invalidTopK = fakeResponse();
    await retrieveHandler({ params: { repositoryId: "d99205ac-705c-4fc5-bd44-47cc7db1973b" }, body: { query: "test", topK: 51 } } as unknown as Request, invalidTopK.response);
    assert.equal(invalidTopK.status(), 400);
    assert.match(JSON.stringify(invalidTopK.payload()), /topK/);
    const emptyRetrieve = fakeResponse();
    await retrieveHandler({ params: { repositoryId: "d99205ac-705c-4fc5-bd44-47cc7db1973b" }, body: {} } as unknown as Request, emptyRetrieve.response);
    assert.equal(emptyRetrieve.status(), 400);
    console.log("Retrieval API validation tests passed: repository IDs, non-empty question/query, and topK limits.");
}

await run();
