import type { Node } from "web-tree-sitter";
import type { ParsedSource } from "./types.js";
import type { ExtractedReference } from "./reference-types.js";

function nodeText(node: Node): string {
    return node.text.trim();
}

function lineNumber(node: Node): number {
    return node.startPosition.row + 1;
}

function endLineNumber(node: Node): number {
    return node.endPosition.row + 1;
}

function findChild(node: Node, types: string[]): Node | null {
    for (const child of node.namedChildren) {
        if (types.includes(child.type)) {
            return child;
        }
    }

    return null;
}

function extractJavaReferences(
    parsed: ParsedSource,
    filePath: string,
    sourceSymbol: string,
    startLine: number,
    endLine: number
): ExtractedReference[] {
    const references: ExtractedReference[] = [];

    function visit(node: Node): void {
        const nodeStart = lineNumber(node);
        const nodeEnd = endLineNumber(node);

        if (nodeEnd < startLine || nodeStart > endLine) {
            return;
        }

        if (node.type === "method_invocation") {
            const nameNode = node.childForFieldName("name");

            if (nameNode) {
                references.push({
                    sourceSymbol,
                    targetName: nodeText(nameNode),
                    type: "CALLS",
                    filePath,
                    line: lineNumber(node)
                });
            }
        }

        for (const child of node.namedChildren) {
            visit(child);
        }
    }

    visit(parsed.tree.rootNode);

    return references;
}

function extractJavaScriptReferences(
    parsed: ParsedSource,
    filePath: string,
    sourceSymbol: string,
    startLine: number,
    endLine: number
): ExtractedReference[] {
    const references: ExtractedReference[] = [];

    function visit(node: Node): void {
        const nodeStart = lineNumber(node);
        const nodeEnd = endLineNumber(node);

        if (nodeEnd < startLine || nodeStart > endLine) {
            return;
        }

        if (node.type === "call_expression") {
            const functionNode = findChild(node, [
                "identifier",
                "member_expression",
                "function"
            ]);

            if (functionNode) {
                let targetName: string | null = null;

                if (functionNode.type === "identifier") {
                    targetName = nodeText(functionNode);
                } else if (functionNode.type === "member_expression") {
                    const property =
                        functionNode.childForFieldName("property");

                    if (property) {
                        targetName = nodeText(property);
                    }
                }

                if (targetName) {
                    references.push({
                        sourceSymbol,
                        targetName,
                        type: "CALLS",
                        filePath,
                        line: lineNumber(node)
                    });
                }
            }
        }

        for (const child of node.namedChildren) {
            visit(child);
        }
    }

    visit(parsed.tree.rootNode);

    return references;
}

export function extractReferences(
    parsed: ParsedSource,
    filePath: string,
    sourceSymbol: string,
    startLine: number,
    endLine: number
): ExtractedReference[] {
    if (parsed.language === "java") {
        return extractJavaReferences(
            parsed,
            filePath,
            sourceSymbol,
            startLine,
            endLine
        );
    }

    return extractJavaScriptReferences(
        parsed,
        filePath,
        sourceSymbol,
        startLine,
        endLine
    );
}
