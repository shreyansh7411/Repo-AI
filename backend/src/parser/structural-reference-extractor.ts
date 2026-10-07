import type { Node } from "web-tree-sitter";
import type { ParsedSource } from "./types.js";

export type StructuralRelationshipType = "EXTENDS" | "IMPLEMENTS" | "IMPORTS";

export interface StructuralReference {
    type: StructuralRelationshipType;
    sourceName: string;
    sourceLine: number;
    targetName?: string;
    modulePath?: string;
    importedName?: string;
    isDefaultImport?: boolean;
}

const text = (node: Node | null | undefined) => node?.text.trim() ?? "";

function descendants(node: Node | null, type: string): Node[] {
    if (!node) return [];
    const found: Node[] = [];
    for (const child of node.namedChildren) {
        if (child.type === type) found.push(child);
        found.push(...descendants(child, type));
    }
    return found;
}

function importedBindings(clause: Node): Array<{ name: string; isDefault: boolean }> {
    const bindings: Array<{ name: string; isDefault: boolean }> = [];
    for (const child of clause.namedChildren) {
        if (child.type === "identifier") {
            bindings.push({ name: text(child), isDefault: true });
        } else if (child.type === "namespace_import") {
            const name = child.namedChildren.find(n => n.type === "identifier");
            if (name) bindings.push({ name: text(name), isDefault: false });
        } else if (child.type === "named_imports") {
            for (const specifier of child.namedChildren) {
                if (specifier.type !== "import_specifier") continue;
                const imported = specifier.childForFieldName("name") ?? specifier.namedChildren[0];
                if (imported) bindings.push({ name: text(imported), isDefault: false });
            }
        }
    }
    return bindings;
}

export function extractStructuralReferences(parsed: ParsedSource): StructuralReference[] {
    const refs: StructuralReference[] = [];
    function visit(node: Node): void {
        if (parsed.language === "java" && ["class_declaration", "interface_declaration", "enum_declaration"].includes(node.type)) {
            const name = text(node.childForFieldName("name"));
            const superclass = node.childForFieldName("superclass");
            const supertype = superclass?.namedChildren[0];
            if (name && supertype) refs.push({ type: "EXTENDS", sourceName: name, sourceLine: node.startPosition.row + 1, targetName: text(supertype).split("<")[0].trim() });
            const interfaces = node.childForFieldName("interfaces");
            for (const item of descendants(interfaces, "type_identifier")) {
                if (name) refs.push({ type: "IMPLEMENTS", sourceName: name, sourceLine: node.startPosition.row + 1, targetName: text(item) });
            }
            // Java interfaces may extend several interfaces.
            if (node.type === "interface_declaration") {
                const extendsNode = node.namedChildren.find(c => c.type === "extends_interfaces");
                for (const item of extendsNode?.namedChildren ?? []) {
                    refs.push({ type: "EXTENDS", sourceName: name, sourceLine: node.startPosition.row + 1, targetName: text(item).split("<")[0] });
                }
            }
        }

        if (parsed.language !== "java" && node.type === "class_declaration") {
            const name = text(node.childForFieldName("name"));
            const heritage = node.namedChildren.find(c => c.type === "class_heritage");
            for (const part of heritage?.namedChildren ?? []) {
                if (part.type === "extends_clause") {
                    const target = part.childForFieldName("value") ?? part.namedChildren[0];
                    if (name && target) refs.push({ type: "EXTENDS", sourceName: name, sourceLine: node.startPosition.row + 1, targetName: text(target).split("<")[0] });
                } else if (part.type === "implements_clause") {
                    for (const target of part.namedChildren) {
                        if (name) refs.push({ type: "IMPLEMENTS", sourceName: name, sourceLine: node.startPosition.row + 1, targetName: text(target).split("<")[0] });
                    }
                }
            }
        }

        if (parsed.language === "java" && node.type === "import_declaration") {
            if (/^import\s+static\b/.test(text(node))) {
                for (const child of node.namedChildren) visit(child);
                return;
            }
            const raw = text(node).replace(/^import\s+static\s+|^import\s+|;$/g, "").trim();
            if (raw && !raw.endsWith(".*")) {
                refs.push({ type: "IMPORTS", sourceName: "", sourceLine: node.startPosition.row + 1, modulePath: raw.replaceAll(".", "/"), importedName: raw.split(".").at(-1) });
            }
        }

        if (parsed.language !== "java" && node.type === "import_statement") {
            const sourceNode = node.childForFieldName("source");
            const modulePath = sourceNode?.namedChildren.map(text).join("") ?? text(sourceNode).replace(/^['"]|['"]$/g, "");
            const clause = node.namedChildren.find(c => c.type === "import_clause");
            if (modulePath && clause) {
                for (const binding of importedBindings(clause)) {
                    const specifier = clause.namedChildren.find(c => c.type === "named_imports")?.namedChildren.find(c => c.type === "import_specifier" && (text(c.childForFieldName("alias")) === binding.name || text(c.childForFieldName("name")) === binding.name));
                    const importedName = binding.isDefault ? "default" : text(specifier?.childForFieldName("name") ?? specifier?.namedChildren[0]) || binding.name;
                    refs.push({ type: "IMPORTS", sourceName: "", sourceLine: node.startPosition.row + 1, modulePath, importedName, isDefaultImport: binding.isDefault });
                }
            }
        }
        for (const child of node.namedChildren) visit(child);
    }
    visit(parsed.tree.rootNode);
    return refs;
}
