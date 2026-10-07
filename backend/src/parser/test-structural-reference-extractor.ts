import assert from "node:assert/strict";
import { ParserService } from "./parser-service.js";
import { extractStructuralReferences } from "./structural-reference-extractor.js";

const parser = await ParserService.initialize();
const java = await parser.parseSource("Child.java", `package sample;\nimport sample.Parent;\nimport sample.Contract;\nclass Child extends Parent implements Contract {}`);
const typescript = await parser.parseSource("child.ts", `import Base, { Contract as LocalContract, Other } from "./types";\nclass Child extends Base implements LocalContract, Other {}`);
const javascript = await parser.parseSource("child.js", `import { foo, bar as baz } from "./foo.js";\nfunction run() { foo(); baz(); }`);

const javaRefs = extractStructuralReferences(java);
assert.deepEqual(javaRefs.filter(ref => ref.type !== "IMPORTS").map(ref => [ref.type, ref.targetName]), [
    ["EXTENDS", "Parent"],
    ["IMPLEMENTS", "Contract"]
]);
assert.deepEqual(javaRefs.filter(ref => ref.type === "IMPORTS").map(ref => ref.importedName), ["Parent", "Contract"]);

const tsRefs = extractStructuralReferences(typescript);
assert.deepEqual(tsRefs.filter(ref => ref.type !== "IMPORTS").map(ref => [ref.type, ref.targetName]), [
    ["EXTENDS", "Base"],
    ["IMPLEMENTS", "LocalContract"],
    ["IMPLEMENTS", "Other"]
]);
assert.deepEqual(tsRefs.filter(ref => ref.type === "IMPORTS").map(ref => [ref.importedName, ref.isDefaultImport]), [
    ["default", true],
    ["Contract", false],
    ["Other", false]
]);
assert.deepEqual(extractStructuralReferences(javascript).filter(ref => ref.type === "IMPORTS").map(ref => ref.importedName), ["foo", "bar"]);

console.log("Structural reference extractor tests passed.");
