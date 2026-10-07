export const RELATIONSHIP_TYPES = ["CALLS", "IMPORTS", "IMPLEMENTS", "EXTENDS"] as const;
export type RelationshipType = typeof RELATIONSHIP_TYPES[number];
export type TraversalDirection = "INCOMING" | "OUTGOING" | "BOTH";

export interface GraphSymbol {
    id: string;
    name: string;
    type: string;
    fileId: string;
    filePath: string;
    language: string | null;
    startLine: number;
    endLine: number;
    parentSymbolId: string | null;
    parentSymbolName: string | null;
    parentSymbolType: string | null;
}

export interface GraphRelationship {
    id: string;
    type: RelationshipType;
    source: GraphSymbol;
    target: GraphSymbol;
}

export interface TraversalHit {
    symbol: GraphSymbol;
    depth: number;
    direct: boolean;
    relationship: { id: string; type: RelationshipType; fromSymbolId: string; toSymbolId: string };
}

export interface TraversalResult {
    repositoryId: string;
    direction: TraversalDirection;
    target: GraphSymbol;
    maxDepth: number;
    relationshipTypes: RelationshipType[];
    results: TraversalHit[];
}

export interface PathStep {
    symbol: GraphSymbol;
    depth: number;
    relationshipFromPrevious: { id: string; type: RelationshipType; fromSymbolId: string; toSymbolId: string } | null;
}
