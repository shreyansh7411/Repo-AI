import type { Node } from "web-tree-sitter";
import type { ParsedRepositoryFile } from "../ingestion/services/relationship-builder.js";
import type { SymbolType } from "../parser/symbol-types.js";

export interface ChunkSymbol {
    id: string;
    repositoryId: string;
    fileId: string;
    name: string;
    type: SymbolType;
    startLine: number;
    endLine: number;
}

export interface CodeChunkRecord {
    fileId: string;
    symbolId: string | null;
    startLine: number;
    endLine: number;
    content: string;
}

const typeNodes: Record<string, string[]> = {
    CLASS: ["class_declaration"],
    INTERFACE: ["interface_declaration"],
    ENUM: ["enum_declaration"],
    METHOD: ["method_declaration", "method_definition"],
    CONSTRUCTOR: ["constructor_declaration"],
    FUNCTION: ["function_declaration", "variable_declarator"],
    FIELD: ["variable_declarator", "public_field_definition"],
    VARIABLE: ["variable_declarator"]
};

const executable = new Set<SymbolType>(["METHOD", "FUNCTION", "CONSTRUCTOR"]);
const structural = new Set<SymbolType>(["CLASS", "INTERFACE", "ENUM"]);
const MAX_CHUNK_LINES = 180;

function nodeName(node: Node): string {
    return node.childForFieldName("name")?.text.trim() ?? "";
}

function collectNodes(root: Node): Node[] {
    const result: Node[] = [];
    function visit(node: Node): void {
        result.push(node);
        for (const child of node.namedChildren) visit(child);
    }
    visit(root);
    return result;
}

function findNode(symbol: ChunkSymbol, nodes: Node[]): Node | null {
    const allowed = typeNodes[symbol.type] ?? [];
    const candidates = nodes.filter(node =>
        allowed.includes(node.type) &&
        nodeName(node) === symbol.name &&
        node.startPosition.row + 1 <= symbol.startLine &&
        node.endPosition.row + 1 >= symbol.endLine
    );
    candidates.sort((a, b) => (a.endIndex - a.startIndex) - (b.endIndex - b.startIndex));
    const candidate = candidates[0] ?? null;
    if (symbol.type === "FIELD" && candidate?.type === "variable_declarator" && candidate.parent?.type === "field_declaration") {
        return candidate.parent;
    }
    return candidate;
}

function record(
    fileId: string,
    symbolId: string | null,
    content: string,
    startLine: number,
    endLine: number
): CodeChunkRecord | null {
    const actual = content.trim();
    if (!actual || endLine < startLine) return null;
    return { fileId, symbolId, startLine, endLine, content };
}

function splitLarge(
    source: string,
    fileId: string,
    symbolId: string,
    startIndex: number,
    endIndex: number,
    startLine: number,
    endLine: number
): CodeChunkRecord[] {
    if (endLine - startLine + 1 <= MAX_CHUNK_LINES) {
        const chunk = record(fileId, symbolId, source.slice(startIndex, endIndex), startLine, endLine);
        return chunk ? [chunk] : [];
    }

    const lines = source.split(/(?<=\n)/);
    const result: CodeChunkRecord[] = [];
    let line = startLine;
    while (line <= endLine) {
        let finish = Math.min(endLine, line + MAX_CHUNK_LINES - 1);
        if (finish < endLine) {
            const searchFrom = Math.max(line + Math.floor(MAX_CHUNK_LINES / 2), finish - 24);
            for (let candidate = finish; candidate >= searchFrom; candidate--) {
                if ((lines[candidate - 1] ?? "").trim() === "") {
                    finish = candidate;
                    break;
                }
            }
        }
        const content = lines.slice(line - 1, finish).join("");
        const chunk = record(fileId, symbolId, content, line, finish);
        if (chunk) result.push(chunk);
        line = finish + 1;
    }
    return result;
}

function isInside(node: Node, parent: Node): boolean {
    return node.startIndex >= parent.startIndex && node.endIndex <= parent.endIndex && node.id !== parent.id;
}

function declarationStart(node: Node): Node {
    let current = node;
    while (current.parent?.type === "export_statement" || current.parent?.type === "lexical_declaration") {
        current = current.parent;
    }
    if (current.parent?.type === "export_statement") current = current.parent;
    return current;
}

export function buildCodeChunks(
    repositoryId: string,
    files: ParsedRepositoryFile[],
    symbols: ChunkSymbol[]
): CodeChunkRecord[] {
    const symbolsByFile = new Map<string, ChunkSymbol[]>();
    for (const symbol of symbols) {
        if (symbol.repositoryId !== repositoryId) continue;
        const group = symbolsByFile.get(symbol.fileId) ?? [];
        group.push(symbol);
        symbolsByFile.set(symbol.fileId, group);
    }

    const chunks: CodeChunkRecord[] = [];
    for (const file of files) {
        const source = file.parsed.sourceText;
        const allNodes = collectNodes(file.parsed.tree.rootNode);
        const fileSymbols = symbolsByFile.get(file.fileId) ?? [];
        const symbolNodes = fileSymbols.flatMap(symbol => {
            const node = findNode(symbol, allNodes);
            return node ? [{ symbol, node }] : [];
        });
        const handledRanges = new Set<string>();

        for (const { symbol, node } of symbolNodes) {
            const sourceNode = declarationStart(node);
            if (executable.has(symbol.type) || symbol.type === "FIELD" || symbol.type === "VARIABLE") {
                const startLine = sourceNode.startPosition.row + 1;
                const endLine = node.endPosition.row + 1;
                const built = splitLarge(source, file.fileId, symbol.id, sourceNode.startIndex, node.endIndex, startLine, endLine);
                chunks.push(...built);
                for (const item of built) handledRanges.add(`${item.startLine}:${item.endLine}`);
                continue;
            }

            if (structural.has(symbol.type)) {
                const body = node.namedChildren.find(child => ["class_body", "interface_body", "enum_body", "class_heritage"].includes(child.type));
                const hasExecutableChildren = symbolNodes.some(candidate =>
                    executable.has(candidate.symbol.type) && isInside(candidate.node, node)
                );
                const hasNestedSymbols = symbolNodes.some(candidate => isInside(candidate.node, node));
                let endIndex = node.endIndex;
                let endLine = node.endPosition.row + 1;
                const contextOnly = symbol.type === "ENUM" ? hasExecutableChildren : hasNestedSymbols;
                if (contextOnly && body) {
                    if (symbol.type === "ENUM") {
                        const firstExecutable = symbolNodes
                            .filter(candidate => executable.has(candidate.symbol.type) && isInside(candidate.node, node))
                            .sort((a, b) => a.node.startIndex - b.node.startIndex)[0];
                        endIndex = firstExecutable?.node.startIndex ?? body.startIndex + 1;
                    } else {
                        endIndex = Math.min(node.endIndex, body.startIndex + 1);
                    }
                    endLine = source.slice(0, endIndex).split("\n").length;
                }
                const content = source.slice(sourceNode.startIndex, endIndex);
                const chunk = record(file.fileId, symbol.id, content, sourceNode.startPosition.row + 1, endLine);
                if (chunk) {
                    chunks.push(...splitLarge(source, file.fileId, symbol.id, sourceNode.startIndex, endIndex, chunk.startLine, chunk.endLine));
                    handledRanges.add(`${chunk.startLine}:${chunk.endLine}`);
                }
            }
        }

        // Preserve meaningful top-level statements and type declarations that
        // have no extracted symbol (for example app.use(...) or type aliases).
        const root = file.parsed.tree.rootNode;
        for (const node of root.namedChildren) {
            if (["comment", "import_statement", "import_declaration", "package_declaration", "export_clause"].includes(node.type)) continue;
            if (symbolNodes.some(item => isInside(item.node, node) || item.node.id === node.id)) continue;
            const content = source.slice(node.startIndex, node.endIndex);
            if (!content.trim()) continue;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            if (handledRanges.has(`${startLine}:${endLine}`)) continue;
            chunks.push(...splitLarge(source, file.fileId, "", node.startIndex, node.endIndex, startLine, endLine).map(chunk => ({ ...chunk, symbolId: null })));
        }
    }

    const unique = new Map<string, CodeChunkRecord>();
    for (const chunk of chunks) {
        const key = `${chunk.fileId}\0${chunk.startLine}\0${chunk.endLine}\0${chunk.content}`;
        if (!unique.has(key)) unique.set(key, chunk);
    }
    return [...unique.values()];
}
