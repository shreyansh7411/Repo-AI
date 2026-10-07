import type { ParsedSource } from "../../parser/types.js";
import type { SymbolType } from "../../parser/symbol-types.js";
import { extractReferences } from "../../parser/reference-extractor.js";
import { extractStructuralReferences } from "../../parser/structural-reference-extractor.js";
import {
    buildSymbolResolverIndex,
    resolveTargetSymbol,
    type ResolvableSymbol
} from "../../parser/symbol-resolver.js";
import type { RelationshipRecord } from "./relationship-repository.js";

export const CALL_SOURCE_TYPES = new Set<SymbolType>([
    "METHOD",
    "FUNCTION"
]);

export interface ParsedRepositoryFile {
    fileId: string;
    relativePath: string;
    parsed: ParsedSource;
}

function normalizeRelative(value: string): string {
    const parts: string[] = [];
    for (const part of value.replaceAll("\\", "/").split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") parts.pop();
        else parts.push(part);
    }
    return parts.join("/");
}

const importExtensions = [".ts", ".tsx", ".js", ".jsx"];

function resolveImportedFile(
    importer: ParsedRepositoryFile,
    modulePath: string,
    files: ParsedRepositoryFile[]
): ParsedRepositoryFile | null {
    const normalizedModule = modulePath.replaceAll("\\", "/");
    const candidates: string[] = [];
    if (normalizedModule.startsWith(".")) {
        const importerPath = normalizeRelative(importer.relativePath);
        const base = normalizeRelative(`${importerPath.split("/").slice(0, -1).join("/")}/${normalizedModule}`);
        candidates.push(base, ...importExtensions.map(extension => base + extension), ...importExtensions.map(extension => `${base}/index${extension}`));
    } else if (importer.parsed.language === "java") {
        const suffix = normalizedModule.replaceAll(".", "/");
        candidates.push(`${suffix}.java`);
        candidates.push(...files.filter(file => file.relativePath.replaceAll("\\", "/").endsWith(`/${suffix}.java`)).map(file => file.relativePath.replaceAll("\\", "/")));
    }
    const normalizedFiles = new Map(files.map(file => [normalizeRelative(file.relativePath), file]));
    const matches = [...new Set(candidates)].map(candidate => normalizedFiles.get(normalizeRelative(candidate))).filter((file): file is ParsedRepositoryFile => !!file);
    return matches.length === 1 ? matches[0] : null;
}

function defaultExportNames(file: ParsedRepositoryFile): Set<string> {
    const names = new Set<string>();
    function visit(node: ParsedSource["tree"]["rootNode"]): void {
        if (node.type === "export_statement" && /^export\s+default\b/.test(node.text)) {
            const declaration = node.childForFieldName("declaration");
            const name = declaration?.childForFieldName("name");
            if (name) names.add(name.text.trim());
        }
        for (const child of node.namedChildren) visit(child);
    }
    visit(file.parsed.tree.rootNode);
    return names;
}

function isInsideNestedCallable(
    line: number,
    source: ResolvableSymbol,
    fileSymbols: ResolvableSymbol[]
): boolean {
    return fileSymbols.some(other => {
        if (other.id === source.id) {
            return false;
        }

        if (!CALL_SOURCE_TYPES.has(other.type)) {
            return false;
        }

        const nested =
            other.startLine >= source.startLine &&
            other.endLine <= source.endLine &&
            (other.startLine !== source.startLine ||
                other.endLine !== source.endLine);

        if (!nested) {
            return false;
        }

        return line >= other.startLine && line <= other.endLine;
    });
}

export function buildCallRelationships(
    repositoryId: string,
    parsedFiles: ParsedRepositoryFile[],
    symbols: ResolvableSymbol[]
): RelationshipRecord[] {
    const repositorySymbols = symbols.filter(
        symbol => symbol.repositoryId === repositoryId
    );
    const index = buildSymbolResolverIndex(repositorySymbols);
    const edges = new Map<string, RelationshipRecord>();
    const symbolsByFile = new Map<string, ResolvableSymbol[]>();

    for (const symbol of repositorySymbols) {
        const list = symbolsByFile.get(symbol.fileId);
        if (list) {
            list.push(symbol);
        } else {
            symbolsByFile.set(symbol.fileId, [symbol]);
        }
    }

    for (const file of parsedFiles) {
        const fileSymbols = symbolsByFile.get(file.fileId) ?? [];

        for (const source of fileSymbols) {
            if (!CALL_SOURCE_TYPES.has(source.type)) {
                continue;
            }

            const references = extractReferences(
                file.parsed,
                file.relativePath,
                source.name,
                source.startLine,
                source.endLine
            );

            for (const reference of references) {
                if (
                    isInsideNestedCallable(
                        reference.line,
                        source,
                        fileSymbols
                    )
                ) {
                    continue;
                }

                const targetSymbolId = resolveTargetSymbol(
                    {
                        symbols: repositorySymbols,
                        source,
                        targetName: reference.targetName
                    },
                    index
                );

                if (!targetSymbolId) {
                    continue;
                }

                const key = `${source.id}\0${targetSymbolId}\0CALLS`;
                edges.set(key, {
                    sourceSymbolId: source.id,
                    targetSymbolId,
                    type: "CALLS"
                });
            }
        }
    }

    const structuralDiagnostics: string[] = [];
    for (const file of parsedFiles) {
        const refs = extractStructuralReferences(file.parsed);
        for (const reference of refs) {
            const sourceCandidates = (symbolsByFile.get(file.fileId) ?? []).filter(symbol =>
                reference.type === "IMPORTS"
                    ? ["CLASS", "INTERFACE", "ENUM", "FUNCTION"].includes(symbol.type)
                    : symbol.name === reference.sourceName && symbol.startLine <= reference.sourceLine && symbol.endLine >= reference.sourceLine && ["CLASS", "INTERFACE", "ENUM"].includes(symbol.type)
            );
            let source = sourceCandidates.length === 1 ? sourceCandidates[0] : null;
            if (reference.type === "IMPORTS" && sourceCandidates.length > 1) {
                // Imports are file-scoped in V1. Use one stable file representative.
                source = sourceCandidates.sort((a, b) => a.startLine - b.startLine)[0];
            }
            if (!source) {
                structuralDiagnostics.push(`${file.relativePath}:${reference.sourceLine} ${reference.type}: source symbol is missing or ambiguous`);
                continue;
            }

            let targets: ResolvableSymbol[] = [];
            if (reference.type === "IMPORTS") {
                const importedFile = resolveImportedFile(file, reference.modulePath ?? "", parsedFiles);
                if (!importedFile) {
                    structuralDiagnostics.push(`${file.relativePath}:${reference.sourceLine} IMPORTS ${reference.modulePath}: module not resolved`);
                    continue;
                }
                const inTargetFile = (symbolsByFile.get(importedFile.fileId) ?? []).filter(symbol =>
                    ["CLASS", "INTERFACE", "ENUM", "FUNCTION"].includes(symbol.type)
                );
                if (reference.isDefaultImport) {
                    const defaults = defaultExportNames(importedFile);
                    targets = inTargetFile.filter(symbol => defaults.has(symbol.name));
                    if (targets.length === 0 && inTargetFile.length === 1) targets = inTargetFile;
                } else {
                    targets = inTargetFile.filter(symbol => symbol.name === reference.importedName);
                }
            } else {
                targets = (index.byName.get(reference.targetName ?? "") ?? []).filter(symbol => {
                    if (symbol.repositoryId !== repositoryId) return false;
                    if (reference.type === "EXTENDS") {
                        return reference.sourceName && ["CLASS", "INTERFACE"].includes(source!.type) && ["CLASS", "INTERFACE"].includes(symbol.type);
                    }
                    return symbol.type === "INTERFACE";
                });
                const sameFile = targets.filter(target => target.fileId === source!.fileId);
                if (sameFile.length) targets = sameFile;
            }

            if (targets.length !== 1) {
                structuralDiagnostics.push(`${file.relativePath}:${reference.sourceLine} ${reference.type} ${reference.targetName ?? reference.importedName}: ${targets.length ? "ambiguous" : "target not resolved"}`);
                continue;
            }
            const target = targets[0];
            if (target.repositoryId !== repositoryId) continue;
            const key = `${source.id}\0${target.id}\0${reference.type}`;
            edges.set(key, { sourceSymbolId: source.id, targetSymbolId: target.id, type: reference.type });
        }
    }
    if (structuralDiagnostics.length) {
        console.warn(`Skipped ${structuralDiagnostics.length} unresolved structural relationships`, structuralDiagnostics.slice(0, 20));
    }

    return [...edges.values()];
}
