export const EMBEDDING_DIMENSIONS = 384;

export interface EmbeddingChunk {
    id: string;
    repositoryId: string;
    fileId: string;
    filePath: string;
    symbolId: string | null;
    symbolName: string | null;
    symbolType: string | null;
    startLine: number;
    endLine: number;
    content: string;
}

export interface SearchChunk extends EmbeddingChunk {
    similarity: number;
}

export interface EmbeddingProvider {
    embedBatch(texts: string[], purpose?: "document" | "query"): Promise<number[][]>;
}

export function validateEmbedding(vector: number[]): void {
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS ||
        vector.some(value => !Number.isFinite(value))) {
        throw new Error(`Embedding must contain exactly ${EMBEDDING_DIMENSIONS} finite numbers.`);
    }
    if (vector.every(value => value === 0)) throw new Error("Embedding cannot be a zero vector for cosine search.");
}

export function embeddingText(chunk: EmbeddingChunk): string {
    const context = [
        `File: ${chunk.filePath}`,
        chunk.symbolName ? `Symbol: ${chunk.symbolName}` : "",
        chunk.symbolType ? `Symbol type: ${chunk.symbolType}` : "",
        `Lines: ${chunk.startLine}-${chunk.endLine}`
    ].filter(Boolean).join("\n");
    return `${context}\n\n${chunk.content}`;
}
