import fs from "fs/promises";
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
    repositoryPath: string
): Promise<DiscoveredFile[]> {
    const files: DiscoveredFile[] = [];

    async function walk(currentPath: string): Promise<void> {
        const entries = await fs.readdir(currentPath, {
            withFileTypes: true
        });

        for (const entry of entries) {
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

            const stats = await fs.stat(fullPath);

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
