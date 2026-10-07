import type { SearchChunk } from "../embeddings/types.js";

export type EvidenceProvenance = "SEMANTIC" | "STRUCTURAL" | "BOTH";

export interface StructuralSymbol {
    id: string;
    repositoryId: string;
    fileId: string;
    filePath: string;
    language?: string | null;
    name: string;
    symbolType: string;
    startLine: number;
    endLine: number;
    signature: string | null;
}

export interface StructuralRelationship {
    id: string;
    type: string;
    source: StructuralSymbol;
    target: StructuralSymbol;
}

export interface Evidence {
    id: string;
    kind: "CHUNK" | "RELATIONSHIP";
    provenance: EvidenceProvenance;
    repositoryId: string;
    filePath: string;
    symbolId: string | null;
    symbol: string | null;
    symbolType: string | null;
    startLine: number;
    endLine: number;
    content: string;
    relationship?: { id: string; type: string; source: string; target: string };
    similarity?: number;
    score: number;
}

export interface RetrievalResult {
    repositoryId: string;
    query: string;
    semantic: SearchChunk[];
    semanticError?: string;
    symbols: StructuralSymbol[];
    relationships: StructuralRelationship[];
    evidence: Evidence[];
    context: string;
    contextChars: number;
    truncated: boolean;
}

export interface Citation {
    filePath: string;
    startLine: number;
    endLine: number;
    symbol: string | null;
    evidenceId: string;
}
