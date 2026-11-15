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

export type ImpactCategory = "caller" | "importer" | "implementor" | "subclass";
export type ImpactClassification = "direct" | "indirect";

/** Ordered from the selected target to an affected symbol. Relationship source/target
 * retain the actual direction stored in the repository graph. */
export interface ImpactEvidencePath {
    direction: "INCOMING";
    symbols: GraphSymbol[];
    relationships: GraphRelationship[];
}

export interface ImpactPathEvidence extends ImpactEvidencePath {
    category: ImpactCategory;
}

/** One unique affected symbol within one dependency category. */
export interface ImpactEvidence {
    symbolId: string;
    name: string;
    type: string;
    fileId: string;
    filePath: string;
    language: string | null;
    startLine: number;
    endLine: number;
    parentSymbolId: string | null;
    parentSymbolName: string | null;
    depth: number;
    direct: boolean;
    relationshipType: RelationshipType;
    relationshipId: string;
    category: ImpactCategory;
    /** IMPORTS edges identify the dependent file; they do not establish symbol usage. */
    evidenceScope: "SYMBOL" | "FILE";
    classification: ImpactClassification;
    minDepth: number;
    symbol: GraphSymbol;
    file: { id: string; path: string; language: string | null };
    evidencePaths: ImpactPathEvidence[];
    additionalPathsOmitted: boolean;
}

export interface ImpactAffectedSymbol {
    symbol: GraphSymbol;
    file: { id: string; path: string; language: string | null };
    categories: ImpactCategory[];
    evidenceScopes: Array<"SYMBOL" | "FILE">;
    classification: ImpactClassification;
    minDepth: number;
    evidencePaths: ImpactPathEvidence[];
    additionalPathsOmitted: boolean;
}

export interface ImpactAffectedFile {
    fileId: string;
    path: string;
    language: string | null;
    minDepth: number;
    relationshipTypes: RelationshipType[];
    symbols: Array<{ symbolId: string; name: string }>;
}

export interface ImpactAnalysisResult {
    repositoryId: string;
    target: GraphSymbol;
    maxDepth: number;
    callers: ImpactEvidence[];
    importers: ImpactEvidence[];
    /** Backward-compatible union of implementors and subclasses. */
    implementations: ImpactEvidence[];
    implementors: ImpactEvidence[];
    subclasses: ImpactEvidence[];
    affectedSymbols: ImpactAffectedSymbol[];
    affectedFiles: ImpactAffectedFile[];
    edgeProcessingLimit: number;
    resultLimit: number;
    evidencePathLimit: number;
    traversalTruncated: boolean;
    evidencePathsTruncated: boolean;
    resultsTruncated: boolean;
    /** Backward-compatible aggregate: true if any traversal, evidence path, or result was omitted. */
    pathsTruncated: boolean;
    interpretation: string;
}
