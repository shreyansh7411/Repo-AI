import type { Node } from "web-tree-sitter";
import type { ParsedSource } from "./types.js";
import type { ExtractedSymbol, SymbolType } from "./symbol-types.js";

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
    for (const child of node.children) {
        if (types.includes(child.type)) {
            return child;
        }
    }
    return null;
}

function getName(node: Node): string | null {
    const nameNode = findChild(node, [
        "identifier",
        "type_identifier",
        "property_identifier",
        "field_identifier",
        "private_property_identifier"
    ]);

    return nameNode ? nodeText(nameNode) : null;
}

function makeSymbol(
    node: Node,
    name: string,
    type: SymbolType,
    filePath: string,
    parentSymbol: string | null,
    signature: string | null
): ExtractedSymbol {
    return {
        name,
        type,
        filePath,
        startLine: lineNumber(node),
        endLine: endLineNumber(node),
        parentSymbol,
        signature
    };
}

function extractJava(root: Node, filePath: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    const typeMap: Record<string, SymbolType> = {
        class_declaration: "CLASS",
        interface_declaration: "INTERFACE",
        enum_declaration: "ENUM",
        method_declaration: "METHOD",
        constructor_declaration: "CONSTRUCTOR"
    };

    function visit(node: Node, parent: string | null): void {
        if (node.type === "field_declaration") {
            const declarators = node.namedChildren.filter(
                child => child.type === "variable_declarator"
            );

            for (const declarator of declarators) {
                const nameNode = declarator.childForFieldName("name");
                if (!nameNode) continue;

                symbols.push(
                    makeSymbol(
                        declarator,
                        nodeText(nameNode),
                        "FIELD",
                        filePath,
                        parent,
                        nodeText(node).replace(/;$/, "").trim()
                    )
                );
            }
            return;
        }

        const symbolType = typeMap[node.type];

        if (!symbolType) {
            for (const child of node.namedChildren) {
                visit(child, parent);
            }
            return;
        }

        const name = getName(node);

        if (!name) {
            for (const child of node.namedChildren) {
                visit(child, parent);
            }
            return;
        }

        const signature =
            symbolType === "METHOD" || symbolType === "CONSTRUCTOR"
                ? nodeText(node).split("{")[0].trim()
                : null;

        symbols.push(
            makeSymbol(node, name, symbolType, filePath, parent, signature)
        );

        const childParent =
            symbolType === "CLASS" ||
            symbolType === "INTERFACE" ||
            symbolType === "ENUM"
                ? name
                : parent;

        for (const child of node.namedChildren) {
            visit(child, childParent);
        }
    }

    visit(root, null);
    return symbols;
}

function extractJavaScript(
    root: Node,
    filePath: string
): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    const typeMap: Record<string, SymbolType> = {
        class_declaration: "CLASS",
        function_declaration: "FUNCTION",
        method_definition: "METHOD",
        interface_declaration: "INTERFACE",
        enum_declaration: "ENUM",
        public_field_definition: "FIELD"
    };

    function visit(node: Node, parent: string | null): void {
        const symbolType = typeMap[node.type];

        if (symbolType) {
            const name =
                node.childForFieldName("name")?.text.trim() ??
                getName(node);

            if (name) {
                const signature =
                    symbolType === "METHOD" ||
                    symbolType === "FUNCTION"
                        ? nodeText(node).split("{")[0].trim()
                        : symbolType === "FIELD"
                            ? nodeText(node).replace(/;$/, "").trim()
                            : null;

                symbols.push(
                    makeSymbol(
                        node,
                        name,
                        symbolType,
                        filePath,
                        parent,
                        signature
                    )
                );

                const childParent =
                    symbolType === "CLASS" ||
                    symbolType === "INTERFACE" ||
                    symbolType === "ENUM"
                        ? name
                        : parent;

                for (const child of node.namedChildren) {
                    visit(child, childParent);
                }
                return;
            }
        }

        if (node.type === "variable_declarator") {
            const nameNode = node.childForFieldName("name");
            const valueNode = node.childForFieldName("value");

            if (nameNode) {
                const isFunction =
                    valueNode?.type === "arrow_function" ||
                    valueNode?.type === "function_expression";

                symbols.push(
                    makeSymbol(
                        node,
                        nodeText(nameNode),
                        isFunction ? "FUNCTION" : "VARIABLE",
                        filePath,
                        parent,
                        nodeText(node)
                    )
                );

                if (valueNode && isFunction) {
                    for (const child of valueNode.namedChildren) {
                        visit(child, parent);
                    }
                }
            }
            return;
        }

        for (const child of node.namedChildren) {
            visit(child, parent);
        }
    }

    visit(root, null);
    return symbols;
}

export function extractSymbols(
    parsed: ParsedSource,
    filePath: string
): ExtractedSymbol[] {
    if (parsed.language === "java") {
        return extractJava(parsed.tree.rootNode, filePath);
    }

    return extractJavaScript(parsed.tree.rootNode, filePath);
}
