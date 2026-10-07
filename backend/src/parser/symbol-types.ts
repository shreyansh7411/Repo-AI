export type SymbolType =
    | "CLASS"
    | "INTERFACE"
    | "ENUM"
    | "METHOD"
    | "CONSTRUCTOR"
    | "FUNCTION"
    | "FIELD"
    | "VARIABLE";

export interface ExtractedSymbol {
    name: string;
    type: SymbolType;
    filePath: string;
    startLine: number;
    endLine: number;
    parentSymbol: string | null;
    signature: string | null;
}
