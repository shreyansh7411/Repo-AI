import assert from "node:assert/strict";
import { ParserService } from "../parser/parser-service.js";
import { extractSymbols } from "../parser/symbol-extractor.js";
import { buildCodeChunks } from "./code-chunk-builder.js";

const parser = await ParserService.initialize();
const cases = [
    {
        path: "Payment.java",
        source: `package sample;\nimport java.util.List;\n\nclass Payment {\n    private int amount;\n    Payment() { amount = 1; }\n    int total() { return amount; }\n}\nclass FieldOnly { private int value; }\ninterface Payable { int total(); }\nenum Status { NEW, DONE; void reset() {} }`,
        required: ["CLASS:Payment", "FIELD:amount", "CONSTRUCTOR:Payment", "METHOD:total", "CLASS:FieldOnly", "FIELD:value", "METHOD:reset", "INTERFACE:Payable", "ENUM:Status"]
    },
    {
        path: "UserService.ts",
        source: `export class UserService {\n  private count = 0;\n  getUser() { return this.count; }\n}\nexport interface User { id: number; }\nexport function formatUser(value: string) { return value.trim(); }`,
        required: ["CLASS:UserService", "FIELD:count", "METHOD:getUser", "INTERFACE:User", "FUNCTION:formatUser"]
    },
    {
        path: "app.js",
        source: `import { helper } from "./helper.js";\nconst config = { enabled: true };\nfunction run() { return helper(config); }\napp.use(run);`,
        required: ["VARIABLE:config", "FUNCTION:run"]
    },
    {
        path: "component.tsx",
        source: `import React from "react";\nexport const Greeting = () => <h1>Hello</h1>;`,
        required: ["FUNCTION:Greeting"]
    }
];

const files = [];
const symbols = [];
for (let i = 0; i < cases.length; i++) {
    const item = cases[i];
    const parsed = await parser.parseSource(item.path, item.source);
    const fileId = `file-${i}`;
    files.push({ fileId, relativePath: item.path, parsed });
    const extracted = extractSymbols(parsed, item.path);
    for (const symbol of extracted) symbols.push({
        ...symbol,
        id: `symbol-${i}-${symbols.length}`,
        repositoryId: "repo-a",
        fileId
    });
    for (const expected of item.required) {
        assert.ok(extracted.some(symbol => `${symbol.type}:${symbol.name}` === expected), `${item.path} missing ${expected}`);
    }
}

const chunks = buildCodeChunks("repo-a", files, symbols);
const paymentChunks = chunks.filter(chunk => chunk.fileId === "file-0");
assert.ok(paymentChunks.some(chunk => chunk.content.includes("class Payment")));
assert.ok(paymentChunks.some(chunk => chunk.content.includes("private int amount")));
const fieldOnlyId = symbols.find(symbol => symbol.fileId === "file-0" && symbol.name === "FieldOnly")?.id;
assert.ok(paymentChunks.some(chunk => chunk.symbolId === fieldOnlyId && chunk.content.includes("class FieldOnly")));
assert.ok(paymentChunks.some(chunk => chunk.content.includes("private int value")));
assert.ok(paymentChunks.some(chunk => chunk.content.includes("Payment()") && chunk.content.includes("amount = 1")));
assert.ok(paymentChunks.some(chunk => chunk.content.includes("return amount")));
const javaMethod = symbols.find(symbol => symbol.fileId === "file-0" && symbol.name === "total" && symbol.type === "METHOD");
const javaMethodChunk = paymentChunks.find(chunk => chunk.symbolId === javaMethod?.id);
assert.ok(javaMethodChunk);
assert.equal(javaMethodChunk.startLine, 7);
assert.equal(javaMethodChunk.endLine, 7);
assert.ok(javaMethodChunk.content.includes("int total() { return amount; }"));
assert.ok(paymentChunks.some(chunk => chunk.content.includes("interface Payable")));
assert.ok(paymentChunks.some(chunk => chunk.content.includes("int total()")));
assert.ok(paymentChunks.some(chunk => chunk.content.includes("enum Status") && chunk.content.includes("NEW, DONE")));
assert.ok(chunks.some(chunk => chunk.content.includes("export class UserService")));
assert.ok(chunks.some(chunk => chunk.content.includes("formatUser(value: string)")));
assert.ok(chunks.some(chunk => chunk.content.includes("<h1>Hello</h1>")));
const tsxSymbol = symbols.find(symbol => symbol.fileId === "file-3" && symbol.name === "Greeting");
assert.ok(chunks.some(chunk => chunk.symbolId === tsxSymbol?.id && chunk.startLine === 2 && chunk.endLine === 2));
assert.ok(chunks.some(chunk => chunk.symbolId === null && chunk.content.includes("app.use(run)")));
assert.ok(chunks.every(chunk => chunk.startLine >= 1 && chunk.endLine >= chunk.startLine && chunk.content.trim().length > 0));
assert.ok(chunks.every(chunk => chunk.fileId !== "file-foreign"));

const duplicate = [...chunks, ...chunks];
const deduped = buildCodeChunks("repo-a", files, symbols);
assert.equal(deduped.length, chunks.length);
assert.ok(duplicate.length > deduped.length);

const largeSource = `function large() {\n${Array.from({ length: 420 }, (_, i) => `  const value${i} = ${i};`).join("\n")}\n}`;
const largeParsed = await parser.parseSource("large.js", largeSource);
const largeSymbol = extractSymbols(largeParsed, "large.js").find(symbol => symbol.name === "large");
assert.ok(largeSymbol);
const largeChunks = buildCodeChunks("repo-a", [{ fileId: "large-file", relativePath: "large.js", parsed: largeParsed }], [{
    ...largeSymbol,
    id: "large-symbol",
    repositoryId: "repo-a",
    fileId: "large-file"
}]);
assert.ok(largeChunks.length > 1, "oversized functions should split into line-bounded chunks");
assert.ok(largeChunks.every(chunk => chunk.symbolId === "large-symbol" && chunk.endLine - chunk.startLine + 1 <= 180));

const empty = await parser.parseSource("empty.ts", "// comment only\nimport x from './x';\n\n");
assert.equal(buildCodeChunks("repo-a", [{ fileId: "empty", relativePath: "empty.ts", parsed: empty }], []).length, 0);

console.log(`Code chunk builder tests passed (${chunks.length} chunks across fixtures).`);
