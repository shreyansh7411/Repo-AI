import type { GraphSymbol, PathStep, RelationshipType, TraversalHit } from "../graph/types.js";

export type RepositorySearchMode = "semantic" | "structural" | "hybrid";

export interface RepositorySymbol {
    id: string;
    name: string;
    type: string;
    signature: string | null;
    file: { id: string; path: string; language: string | null };
    startLine: number;
    endLine: number;
    parent: { id: string; name: string; type: string } | null;
}

export interface RepositoryFile {
    id: string;
    path: string;
    language: string | null;
    size: number | null;
    hash: string | null;
    symbols: Array<{ id: string; name: string; type: string; signature: string | null; startLine: number; endLine: number; parentSymbolId: string | null }>;
    chunkCount: number;
}

export interface RepositoryEvidence {
    kind: "CODE_CHUNK" | "RELATIONSHIP";
    source: "SEMANTIC" | "STRUCTURAL" | "BOTH";
    file: { id: string; path: string; language: string | null };
    symbol: { id: string; name: string; type: string } | null;
    startLine: number;
    endLine: number;
    content?: string;
    chunkId?: string;
    similarity?: number;
    relationship?: {
        id: string;
        type: RelationshipType;
        sourceSymbol: { id: string; name: string; type: string; fileId: string; filePath: string; startLine: number; endLine: number };
        targetSymbol: { id: string; name: string; type: string; fileId: string; filePath: string; startLine: number; endLine: number };
    };
}

export interface RepositorySearchResult {
    repositoryId: string;
    query: string;
    mode: RepositorySearchMode;
    topK: number;
    maxDepth: number;
    effectiveMaxDepth?: number;
    semanticAvailable: boolean | null;
    semanticError?: string;
    evidence: RepositoryEvidence[];
}

export interface RepositoryTraceResult {
    repositoryId: string;
    direction: "callers" | "callees";
    target: GraphSymbol;
    maxDepth: number;
    results: Array<{
        symbol: GraphSymbol;
        file: { id: string; path: string; language: string | null };
        depth: number;
        relationship: { id: string; type: RelationshipType; fromSymbolId: string; toSymbolId: string };
    }>;
}

export interface RepositoryPathResult {
    repositoryId: string;
    found: boolean;
    pathLength: number;
    maxDepth: number;
    steps: Array<PathStep & { file: { id: string; path: string; language: string | null } }>;
}

export type { TraversalHit };
