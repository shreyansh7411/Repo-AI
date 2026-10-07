import assert from "node:assert/strict";
import path from "node:path";
import { ParserService } from "./parser-service.js";

const repositoryRoot = path.resolve(
    process.cwd(),
    "repositories",
    "Ai-Finance-Controller"
);

const fileCases = [
    {
        label: "Java",
        filePath: path.join(
        repositoryRoot,
        "backend",
        "src",
        "main",
        "java",
        "com",
        "aifincontroller",
        "AiFinControllerApplication.java"
        )
    },
    {
        label: "JavaScript",
        filePath: path.join(repositoryRoot, "frontend", "vite.config.js")
    },
    {
        label: "JSX",
        filePath: path.join(repositoryRoot, "frontend", "src", "App.jsx")
    }
];

const sourceCases = [
    {
        label: "TypeScript",
        filePath: "parser-test.ts",
        source: "const total: number = 42; export { total };"
    },
    {
        label: "TSX",
        filePath: "parser-test.tsx",
        source: "export const Greeting = () => <h1>Hello</h1>;"
    }
];

const parserService = await ParserService.initialize();

for (const testCase of fileCases) {
    const result = await parserService.parseFile(testCase.filePath);
    const rootNode = result.tree.rootNode;

    assert.equal(result.language, {
        Java: "java",
        JavaScript: "javascript",
        JSX: "javascript"
    }[testCase.label]);
    assert.ok(rootNode.type);
    assert.ok(rootNode.childCount > 0);

    console.log(
        `${testCase.label} passed: ${path.relative(process.cwd(), testCase.filePath)} ` +
        `-> ${result.language}, ${rootNode.type}, ${rootNode.childCount} children`
    );

    result.tree.delete();
}

for (const testCase of sourceCases) {
    const result = await parserService.parseSource(
        testCase.filePath,
        testCase.source
    );
    const rootNode = result.tree.rootNode;

    assert.equal(result.language, testCase.label.toLowerCase());
    assert.ok(rootNode.type);
    assert.ok(rootNode.childCount > 0);

    console.log(
        `${testCase.label} passed: ${testCase.filePath} -> ` +
        `${result.language}, ${rootNode.type}, ${rootNode.childCount} children`
    );

    result.tree.delete();
}