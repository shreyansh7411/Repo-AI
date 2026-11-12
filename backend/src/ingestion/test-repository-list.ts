import assert from "node:assert/strict";
import express from "express";
import { pool } from "../config/database.js";
import repositoryRoutes from "./repository-routes.js";

const productionRepositoryId = "d99205ac-705c-4fc5-bd44-47cc7db1973b";
const app = express();
app.use("/api/repositories", repositoryRoutes);
const server = app.listen(0);

try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/repositories`);
    assert.equal(response.status, 200);
    const payload = await response.json() as { repositories: Array<{
        repositoryId: string; name: string; url: string | null; indexingStatus: string;
        fileCount: number; symbolCount: number; createdAt: string; indexedAt: string | null;
    }> };
    const repository = payload.repositories.find(item => item.repositoryId === productionRepositoryId);
    assert.ok(repository, "the indexed production repository should be listed");
    assert.equal(repository.indexingStatus, "INDEXED");
    assert.equal(repository.fileCount, 133);
    assert.equal(repository.symbolCount, 1672);
    assert.ok(repository.createdAt);
    console.log(`Repository list API passed: ${payload.repositories.length} repositories; production entry ${repository.name} has ${repository.fileCount} files and ${repository.symbolCount} symbols.`);
} finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
}
