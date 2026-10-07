import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "../config/database.js";
import { indexRepository } from "./services/repository-service.js";

const javaPayment = `
class PaymentService {
    public void processPayment() {
        validatePayment();
        calculateAmount();
        savePayment();
        savePayment();
        ledger.savePayment();
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

const javaAmbiguousA = `
class AlphaHelper {
    public void helper() {
    }
}
`;

const javaAmbiguousB = `
class BetaHelper {
    public void helper() {
    }
}
`;

const javaAmbiguousCaller = `
class AmbiguousCaller {
    public void run() {
        helper();
    }
}
`;

const javaMissing = `
class MissingTarget {
    public void run() {
        doesNotExist();
    }
}
`;

const javaOrder = `
class OrderService {
    public void checkout() {
        savePayment();
    }
}
`;

const tsUser = `
class UserService {
    getUser() {
        validateUser();
        this.loadUser();
        saveUser();
        cache.saveUser();
    }

    validateUser() {}
    loadUser() {}
    saveUser() {}
}
`;

const jsOrders = `
function formatAmount() {
    return 1;
}

function processOrder() {
    formatAmount();
    formatAmount();
}
`;

const javaBase = `package structural; public class Base {}`;
const javaContractA = `package structural; public interface ContractA {}`;
const javaContractB = `package structural; public interface ContractB {}`;
const javaStructural = `package structural;
import structural.Base;
import structural.ContractA;
import structural.ContractB;
class PaymentService extends Base implements ContractA, ContractB {}`;
const tsTypes = `export default class TsBase {}
export interface TsContract {}
export interface TsOther {}
export function tsFormatter(value: string) { return value.trim(); }`;
const tsStructural = `import { TsBase, TsContract, TsOther } from "./types";
export class TsChild extends TsBase implements TsContract, TsOther {}`;
const jsFoo = `export function foo() {}
export function bar() {}`;
const jsDefault = `export default function defaultThing() {}`;
const jsStructural = `import defaultThing from "./default";
import { foo, bar as localBar } from "./foo.js";
function caller() { defaultThing(); foo(); localBar(); }`;
const missingStructural = `class MissingChild extends NoSuchBase implements NoSuchContract {}`;
const ambiguousTwinOne = `package one; class Twin {}`;
const ambiguousTwinTwo = `package two; class Twin {}`;
const ambiguousStructural = `package ambiguous; class AmbiguousChild extends Twin {}`;
const missingImport = `import { absent } from "./not-present"; export class MissingImport {}`;

async function writeRepo(name: string, files: Record<string, string>) {
    const root = path.join(process.cwd(), "repositories", name);
    await fs.mkdir(root, { recursive: true });

    for (const [relativePath, contents] of Object.entries(files)) {
        const fullPath = path.join(root, relativePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, contents, "utf8");
    }
}

async function relationshipNames(repositoryId: string) {
    const result = await pool.query<{
        source: string;
        target: string;
        type: string;
    }>(
        `
        SELECT source.name AS source, target.name AS target, rel.type
        FROM relationships rel
        JOIN symbols source ON source.id = rel.source_symbol_id
        JOIN symbols target ON target.id = rel.target_symbol_id
        WHERE rel.repository_id = $1
        ORDER BY source.name, target.name
        `,
        [repositoryId]
    );

    return result.rows;
}

async function run() {
    const repoAName = "rel-graph-v1-a";
    const repoBName = "rel-graph-v1-b";
    const repoAUrl = "https://example.invalid/rel-graph-v1-a.git";
    const repoBUrl = "https://example.invalid/rel-graph-v1-b.git";

    await writeRepo(repoAName, {
        "PaymentService.java": javaPayment,
        "AlphaHelper.java": javaAmbiguousA,
        "BetaHelper.java": javaAmbiguousB,
        "AmbiguousCaller.java": javaAmbiguousCaller,
        "MissingTarget.java": javaMissing,
        "OrderService.java": javaOrder,
        "UserService.ts": tsUser,
        "orders.js": jsOrders,
        "structural/Base.java": javaBase,
        "structural/ContractA.java": javaContractA,
        "structural/ContractB.java": javaContractB,
        "structural/PaymentService.java": javaStructural,
        "structural/types.ts": tsTypes,
        "structural/child.ts": tsStructural,
        "structural/foo.js": jsFoo,
        "structural/default.js": jsDefault,
        "structural/main.js": jsStructural,
        "structural/Missing.java": missingStructural,
        "structural/one/Twin.java": ambiguousTwinOne,
        "structural/two/Twin.java": ambiguousTwinTwo,
        "structural/ambiguous/Ambiguous.java": ambiguousStructural,
        "structural/missing.ts": missingImport
    });

    await writeRepo(repoBName, {
        "PaymentService.java": javaPayment
    });

    const first = await indexRepository(repoAName, repoAUrl);
    const second = await indexRepository(repoAName, repoAUrl);
    const other = await indexRepository(repoBName, repoBUrl);

    assert.equal(first.repositoryId, second.repositoryId);
    assert.equal(first.relationshipCount, second.relationshipCount);
    assert.equal(first.chunkCount, second.chunkCount);

    const stored = await relationshipNames(first.repositoryId);
    const persistedChunks = await pool.query<{ count: string; duplicates: string }>(
        `
        SELECT COUNT(*)::text AS count,
               (SELECT COUNT(*)::text FROM (
                   SELECT repository_id, file_id, symbol_id, start_line, end_line, content
                   FROM code_chunks WHERE repository_id = $1
                   GROUP BY repository_id, file_id, symbol_id, start_line, end_line, content
                   HAVING COUNT(*) > 1
               ) d) AS duplicates
        FROM code_chunks WHERE repository_id = $1
        `,
        [first.repositoryId]
    );
    assert.equal(Number(persistedChunks.rows[0].count), first.chunkCount);
    assert.equal(persistedChunks.rows[0].duplicates, "0");
    const pairs = stored.map(row => `${row.source}->${row.target}`);

    assert.equal(stored.some(row => row.type === "CALLS"), true);
    assert.equal(stored.some(row => row.type === "EXTENDS"), true);
    assert.equal(stored.some(row => row.type === "IMPLEMENTS"), true);
    assert.equal(stored.some(row => row.type === "IMPORTS"), true);
    assert.ok(pairs.includes("processPayment->validatePayment"));
    assert.ok(pairs.includes("processPayment->calculateAmount"));
    assert.ok(pairs.includes("processPayment->savePayment"));
    assert.ok(pairs.includes("checkout->savePayment"));
    assert.ok(pairs.includes("getUser->validateUser"));
    assert.ok(pairs.includes("getUser->loadUser"));
    assert.ok(pairs.includes("getUser->saveUser"));
    assert.ok(pairs.includes("processOrder->formatAmount"));
    assert.ok(pairs.includes("PaymentService->Base"));
    assert.ok(pairs.includes("PaymentService->ContractA"));
    assert.ok(pairs.includes("PaymentService->ContractB"));
    assert.ok(pairs.includes("TsChild->TsBase"));
    assert.ok(pairs.includes("TsChild->TsContract"));
    assert.ok(pairs.includes("TsChild->TsOther"));
    assert.ok(pairs.includes("caller->defaultThing"));
    assert.ok(pairs.includes("caller->foo"));
    assert.ok(pairs.includes("caller->bar"));
    assert.equal(pairs.includes("MissingChild->NoSuchBase"), false);
    assert.equal(pairs.includes("MissingChild->NoSuchContract"), false);
    assert.equal(pairs.includes("AmbiguousChild->Twin"), false);
    assert.equal(pairs.includes("MissingImport->absent"), false);
    assert.equal(pairs.includes("run->helper"), false);
    assert.equal(pairs.includes("run->doesNotExist"), false);
    assert.equal(
        pairs.filter(pair => pair.startsWith("noCalls->")).length,
        0,
        "methods with no calls must not produce CALLS relationships"
    );

    const savePaymentEdges = stored.filter(
        row =>
            row.source === "processPayment" && row.target === "savePayment"
    );
    assert.equal(
        savePaymentEdges.length,
        1,
        "duplicate call expressions must collapse to one relationship row"
    );

    const helperEdges = await pool.query<{ n: string }>(
        `
        SELECT COUNT(*)::text AS n
        FROM relationships rel
        JOIN symbols source ON source.id = rel.source_symbol_id
        JOIN symbols target ON target.id = rel.target_symbol_id
        WHERE rel.repository_id = $1
          AND source.name = 'run'
          AND target.name = 'helper'
        `,
        [first.repositoryId]
    );
    assert.equal(helperEdges.rows[0].n, "0");

    const cross = await pool.query<{ n: string }>(
        `
        SELECT COUNT(*)::text AS n
        FROM relationships rel
        JOIN symbols source ON source.id = rel.source_symbol_id
        JOIN symbols target ON target.id = rel.target_symbol_id
        WHERE source.repository_id <> target.repository_id
        `
    );
    assert.equal(cross.rows[0].n, "0");

    const sameNameCrossRepo = await pool.query<{ n: string }>(
        `
        SELECT COUNT(*)::text AS n
        FROM relationships rel
        JOIN symbols source ON source.id = rel.source_symbol_id
        JOIN symbols target ON target.id = rel.target_symbol_id
        WHERE rel.repository_id = $1
          AND target.repository_id = $2
        `,
        [first.repositoryId, other.repositoryId]
    );
    assert.equal(sameNameCrossRepo.rows[0].n, "0");

    console.log("End-to-end indexing result (first pass):");
    console.log(first);
    console.log("End-to-end indexing result (re-index):");
    console.log(second);
    console.log("Isolated second repository:");
    console.log(other);
    console.log("Stored CALLS pairs:");
    console.table(stored);
    console.log("Relationship indexing tests passed.");
}

try {
    await run();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
