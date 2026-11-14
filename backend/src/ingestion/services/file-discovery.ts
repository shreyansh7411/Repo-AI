import { opendir, stat } from "node:fs/promises";
import path from "path";

const SUPPORTED_EXTENSIONS = new Set([
    ".java",
    ".js",
    ".jsx",
    ".ts",
    ".tsx"
]);

const IGNORED_DIRECTORIES = new Set([
    ".git",
    "node_modules",
    "target",
    "dist",
    "build"
]);

export interface DiscoveredFile {
    path: string;
    relativePath: string;
    language: string;
    size: number;
}

export interface DiscoveryLimits {
    maxFiles: number;
    maxFileBytes: number;
    maxSourceBytes: number;
    maxFilesystemEntries: number;
    deadlineAt: number;
    ignoreSymlinks?: boolean;
}

function getLanguage(extension: string): string {
    switch (extension) {
        case ".java":
            return "java";
        case ".js":
            return "javascript";
        case ".jsx":
            return "javascript";
        case ".ts":
            return "typescript";
        case ".tsx":
            return "typescript";
        default:
            return "unknown";
    }
}

export async function discoverFiles(
    repositoryPath: string,
    limits?: DiscoveryLimits
): Promise<DiscoveredFile[]> {
    const files: DiscoveredFile[] = [];
    let totalSourceBytes = 0;
    let visitedEntries = 0;

    function checkLimits(): void {
        if (!limits) return;
        if (Date.now() > limits.deadlineAt) throw new Error("Demo indexing exceeded the configured time limit.");
        if (visitedEntries > limits.maxFilesystemEntries) {
            throw new Error("Repository exceeds the configured demo filesystem-entry limit.");
        }
    }

    async function walk(currentPath: string): Promise<void> {
        checkLimits();
        const directory = await opendir(currentPath);

        for await (const entry of directory) {
            visitedEntries += 1;
            checkLimits();
            // Demo repositories are untrusted; never follow links outside the clone root.
            if (limits?.ignoreSymlinks && entry.isSymbolicLink()) continue;
            if (
                entry.isDirectory() &&
                IGNORED_DIRECTORIES.has(entry.name)
            ) {
                continue;
            }

            const fullPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
                await walk(fullPath);
                continue;
            }

            const extension = path.extname(entry.name).toLowerCase();

            if (!SUPPORTED_EXTENSIONS.has(extension)) {
                continue;
            }

            checkLimits();
            const stats = await stat(fullPath);
            checkLimits();
            if (limits && stats.size > limits.maxFileBytes) {
                throw new Error("Repository contains a source file larger than the demo limit.");
            }
            if (limits && (files.length >= limits.maxFiles || totalSourceBytes + stats.size > limits.maxSourceBytes)) {
                throw new Error("Repository exceeds the configured demo file or source-size limit.");
            }
            totalSourceBytes += stats.size;

            files.push({
                path: fullPath,
                relativePath: path.relative(repositoryPath, fullPath),
                language: getLanguage(extension),
                size: stats.size
            });
        }
    }

    await walk(repositoryPath);

    return files;
}
