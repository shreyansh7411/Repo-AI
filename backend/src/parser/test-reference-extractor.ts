import assert from "node:assert/strict";
import { ParserService } from "./parser-service.js";
import { extractSymbols } from "./symbol-extractor.js";
import { extractReferences } from "./reference-extractor.js";
import type { ParsedSource } from "./types.js";

const parser = await ParserService.initialize();

const javaSource = `
class PaymentService {
    public void processPayment() {
        validatePayment();
        calculateAmount();
        savePayment();
        savePayment();
        service.savePayment();
    }

    public void noCalls() {
    }

    private void validatePayment() {
    }

    private void calculateAmount() {
    }

    private void savePayment() {
    }
}
`;

const tsSource = `
class UserService {
    getUser() {
        validateUser();
        this.loadUser();
        saveUser();
        service.saveUser();
    }

    validateUser() {
    }

    loadUser() {
    }

    saveUser() {
    }
}
`;

const jsSource = `
function formatAmount() {
    return 1;
}

function processOrder() {
    formatAmount();
    formatAmount();
}
`;

function refsFor(
    parsed: ParsedSource,
    filePath: string,
    symbolName: string
) {
    const symbols = extractSymbols(parsed, filePath);
    const symbol = symbols.find(item => item.name === symbolName);
    assert.ok(symbol, `Missing symbol ${symbolName} in ${filePath}`);
    return extractReferences(
        parsed,
        filePath,
        symbol.name,
        symbol.startLine,
        symbol.endLine
    );
}

const javaParsed = await parser.parseSource(
    "PaymentService.java",
    javaSource
);
const tsParsed = await parser.parseSource("UserService.ts", tsSource);
const jsParsed = await parser.parseSource("orders.js", jsSource);

const javaRefs = refsFor(
    javaParsed,
    "PaymentService.java",
    "processPayment"
);
const javaNoCalls = refsFor(
    javaParsed,
    "PaymentService.java",
    "noCalls"
);
const tsRefs = refsFor(tsParsed, "UserService.ts", "getUser");
const jsRefs = refsFor(jsParsed, "orders.js", "processOrder");

assert.deepEqual(
    javaRefs.map(ref => ref.targetName),
    [
        "validatePayment",
        "calculateAmount",
        "savePayment",
        "savePayment",
        "savePayment"
    ]
);
assert.equal(javaNoCalls.length, 0);
assert.deepEqual(
    tsRefs.map(ref => ref.targetName),
    ["validateUser", "loadUser", "saveUser", "saveUser"]
);
assert.deepEqual(
    jsRefs.map(ref => ref.targetName),
    ["formatAmount", "formatAmount"]
);

console.log("\nJava references:");
console.table(javaRefs);
console.log("\nTypeScript references:");
console.table(tsRefs);
console.log("\nJavaScript references:");
console.table(jsRefs);
console.log("Reference extractor tests passed.");
