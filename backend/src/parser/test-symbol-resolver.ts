import assert from "node:assert/strict";
import {
    resolveTargetSymbol,
    type ResolvableSymbol
} from "./symbol-resolver.js";
import type { SymbolType } from "./symbol-types.js";

function symbol(
    partial: Omit<ResolvableSymbol, "type"> & { type: SymbolType }
): ResolvableSymbol {
    return partial;
}

const repoA = "repo-a";
const repoB = "repo-b";
const filePayment = "file-payment";
const fileOther = "file-other";
const fileCaller = "file-caller";
const fileB = "file-b";

const paymentClass = symbol({
    id: "class-payment",
    repositoryId: repoA,
    fileId: filePayment,
    name: "PaymentService",
    type: "CLASS",
    startLine: 1,
    endLine: 40
});

const processPayment = symbol({
    id: "method-process",
    repositoryId: repoA,
    fileId: filePayment,
    name: "processPayment",
    type: "METHOD",
    startLine: 2,
    endLine: 10
});

const validatePayment = symbol({
    id: "method-validate",
    repositoryId: repoA,
    fileId: filePayment,
    name: "validatePayment",
    type: "METHOD",
    startLine: 12,
    endLine: 14
});

const calculateAmount = symbol({
    id: "method-calculate",
    repositoryId: repoA,
    fileId: filePayment,
    name: "calculateAmount",
    type: "METHOD",
    startLine: 16,
    endLine: 18
});

const savePayment = symbol({
    id: "method-save",
    repositoryId: repoA,
    fileId: filePayment,
    name: "savePayment",
    type: "METHOD",
    startLine: 20,
    endLine: 22
});

const noCalls = symbol({
    id: "method-none",
    repositoryId: repoA,
    fileId: filePayment,
    name: "noCalls",
    type: "METHOD",
    startLine: 24,
    endLine: 26
});

const otherClass = symbol({
    id: "class-other",
    repositoryId: repoA,
    fileId: fileOther,
    name: "OtherService",
    type: "CLASS",
    startLine: 1,
    endLine: 20
});

const otherValidate = symbol({
    id: "method-other-validate",
    repositoryId: repoA,
    fileId: fileOther,
    name: "validatePayment",
    type: "METHOD",
    startLine: 2,
    endLine: 8
});

const helperA = symbol({
    id: "method-helper-a",
    repositoryId: repoA,
    fileId: fileOther,
    name: "helper",
    type: "METHOD",
    startLine: 10,
    endLine: 12
});

const helperB = symbol({
    id: "method-helper-b",
    repositoryId: repoA,
    fileId: "file-helper-b",
    name: "helper",
    type: "METHOD",
    startLine: 10,
    endLine: 12
});

const runCaller = symbol({
    id: "method-run",
    repositoryId: repoA,
    fileId: fileCaller,
    name: "run",
    type: "METHOD",
    startLine: 2,
    endLine: 6
});

const formatFn = symbol({
    id: "fn-format",
    repositoryId: repoA,
    fileId: fileCaller,
    name: "formatAmount",
    type: "FUNCTION",
    startLine: 20,
    endLine: 22
});

const processOrder = symbol({
    id: "fn-process-order",
    repositoryId: repoA,
    fileId: fileCaller,
    name: "processOrder",
    type: "FUNCTION",
    startLine: 24,
    endLine: 28
});

const repoBValidate = symbol({
    id: "method-b-validate",
    repositoryId: repoB,
    fileId: fileB,
    name: "validatePayment",
    type: "METHOD",
    startLine: 2,
    endLine: 4
});

const repoASymbols: ResolvableSymbol[] = [
    paymentClass,
    processPayment,
    validatePayment,
    calculateAmount,
    savePayment,
    noCalls,
    otherClass,
    otherValidate,
    helperA,
    helperB,
    runCaller,
    formatFn,
    processOrder
];

function resolve(
    source: ResolvableSymbol,
    targetName: string,
    symbols = repoASymbols
) {
    return resolveTargetSymbol({ symbols, source, targetName });
}

assert.equal(
    resolve(processPayment, "validatePayment"),
    validatePayment.id,
    "same-class method should win over same-named method in another class"
);
assert.equal(resolve(processPayment, "calculateAmount"), calculateAmount.id);
assert.equal(resolve(processPayment, "savePayment"), savePayment.id);
assert.equal(resolve(noCalls, "validatePayment"), validatePayment.id);
assert.equal(
    resolve(runCaller, "savePayment"),
    savePayment.id,
    "unique remaining target in another file should resolve"
);
assert.equal(resolve(processOrder, "formatAmount"), formatFn.id);
assert.equal(resolve(processPayment, "doesNotExist"), null);
assert.equal(
    resolve(runCaller, "helper"),
    null,
    "ambiguous helper() across files must not pick arbitrarily"
);
assert.equal(
    resolve(processPayment, "helper", [
        ...repoASymbols,
        symbol({
            id: "method-helper-local",
            repositoryId: repoA,
            fileId: filePayment,
            name: "helper",
            type: "METHOD",
            startLine: 34,
            endLine: 36
        })
    ]),
    "method-helper-local",
    "unique same-file match should win over same-named methods in other files"
);
assert.equal(
    resolve(processPayment, "validatePayment", [
        ...repoASymbols,
        repoBValidate
    ]),
    validatePayment.id,
    "symbols from another repository must never be selected"
);
assert.equal(
    resolveTargetSymbol({
        symbols: [repoBValidate, processPayment],
        source: processPayment,
        targetName: "validatePayment"
    }),
    null,
    "foreign-repo-only match must not resolve"
);

const overloadA = symbol({
    id: "overload-a",
    repositoryId: repoA,
    fileId: filePayment,
    name: "calculateAmount",
    type: "METHOD",
    startLine: 30,
    endLine: 32
});

assert.equal(
    resolve(processPayment, "calculateAmount", [
        ...repoASymbols,
        overloadA
    ]),
    null,
    "same-class overloads are ambiguous without signatures"
);

console.log("Symbol resolver tests passed.");
