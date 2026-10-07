import type { Language, Tree } from "web-tree-sitter";

export type SupportedLanguage =
    | "java"
    | "javascript"
    | "typescript"
    | "tsx";

export interface ParsedSource {
    language: SupportedLanguage;
    tree: Tree;
    sourceText: string;
}

export type LoadedLanguages = Map<SupportedLanguage, Language>;
