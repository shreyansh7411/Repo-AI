import path from "node:path";
import type { SupportedLanguage } from "./types.js";

const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
    ".java": "java",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx"
};

export function detectLanguage(filePath: string): SupportedLanguage {
    if (!filePath || typeof filePath !== "string") {
        throw new Error("Cannot detect language for a missing file path.");
    }

    const extension = path.extname(filePath).toLowerCase();
    const language = EXTENSION_TO_LANGUAGE[extension];

    if (!language) {
        throw new Error(
            `Unsupported source language for extension: ${extension || "<none>"}`
        );
    }

    return language;
}