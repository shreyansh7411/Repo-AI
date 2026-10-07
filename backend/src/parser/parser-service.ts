import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";
import { detectLanguage } from "./language-detector.js";
import type { LoadedLanguages, ParsedSource, SupportedLanguage } from "./types.js";

const require = createRequire(import.meta.url);

const GRAMMAR_FILES: Record<SupportedLanguage, [string, string]> = {
    java: ["tree-sitter-java", "tree-sitter-java.wasm"],
    javascript: ["tree-sitter-javascript", "tree-sitter-javascript.wasm"],
    typescript: ["tree-sitter-typescript", "tree-sitter-typescript.wasm"],
    tsx: ["tree-sitter-typescript", "tree-sitter-tsx.wasm"]
};

export class ParserService {
    private readonly languages: LoadedLanguages = new Map();
    private readonly parser: Parser;
    private static initialization: Promise<ParserService> | undefined;

    private constructor() {
        try {
            this.parser = new Parser();
        } catch (error) {
            throw new Error("Failed to create the Tree-sitter parser.", {
                cause: error
            });
        }
    }

    public static initialize(): Promise<ParserService> {
        if (!ParserService.initialization) {
            ParserService.initialization = ParserService.create();
        }

        return ParserService.initialization;
    }

    private static async create(): Promise<ParserService> {
        try {
            await Parser.init();
            return new ParserService();
        } catch (error) {
            ParserService.initialization = undefined;
            throw new Error("Failed to initialize Tree-sitter WASM.", {
                cause: error
            });
        }
    }

    public async parseFile(filePath: string): Promise<ParsedSource> {
        if (!filePath || typeof filePath !== "string") {
            throw new Error("Cannot parse a missing source file path.");
        }

        let source: string;

        try {
            source = await fs.readFile(filePath, "utf8");
        } catch (error) {
            throw new Error(`Unable to read source file: ${filePath}`, {
                cause: error
            });
        }

        return this.parseSource(filePath, source);
    }

    public async parseSource(
        filePath: string,
        source: string
    ): Promise<ParsedSource> {
        if (typeof source !== "string") {
            throw new Error(`Invalid source content for file: ${filePath}`);
        }

        const language = detectLanguage(filePath);
        const grammar = await this.loadLanguage(language);
        this.parser.setLanguage(grammar);
        const tree = this.parser.parse(source);

        if (!tree) {
            throw new Error(`Tree-sitter returned no syntax tree for: ${filePath}`);
        }

        return { language, tree, sourceText: source };
    }

    private async loadLanguage(language: SupportedLanguage): Promise<Language> {
        const loaded = this.languages.get(language);

        if (loaded) {
            return loaded;
        }

        const [packageName, wasmFile] = GRAMMAR_FILES[language];
        let wasmPath: string;

        try {
            const packageJsonPath = require.resolve(`${packageName}/package.json`);
            wasmPath = path.join(path.dirname(packageJsonPath), wasmFile);
        } catch (error) {
            throw new Error(`Missing Tree-sitter grammar package: ${packageName}`, {
                cause: error
            });
        }

        try {
            const grammar = await Language.load(wasmPath);
            this.languages.set(language, grammar);
            return grammar;
        } catch (error) {
            throw new Error(`Failed to load ${language} Tree-sitter grammar.`, {
                cause: error
            });
        }
    }
}
