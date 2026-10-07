import { CodeChunkEmbeddingRepository } from "./code-chunk-embedding-repository.js";
import { embeddingText, validateEmbedding, type EmbeddingProvider } from "./types.js";

export interface GenerationResult {
    repositoryId: string;
    processed: number;
    created: number;
    failed: number;
    failures: Array<{ chunkId: string; error: string }>;
}

export class EmbeddingService {
    constructor(
        private readonly repository: CodeChunkEmbeddingRepository,
        private readonly provider: EmbeddingProvider,
        private readonly batchSize = 64
    ) {}

    async generateMissing(repositoryId: string): Promise<GenerationResult> {
        const result: GenerationResult = { repositoryId, processed: 0, created: 0, failed: 0, failures: [] };
        while (true) {
            const chunks = await this.repository.getMissingEmbeddings(repositoryId, this.batchSize);
            if (chunks.length === 0) break;
            result.processed += chunks.length;
            try {
                const vectors = await this.provider.embedBatch(chunks.map(embeddingText), "document");
                if (vectors.length !== chunks.length) throw new Error("Embedding provider returned an unexpected number of vectors.");
                vectors.forEach(validateEmbedding);
                result.created += await this.repository.saveEmbeddings(
                    repositoryId,
                    chunks.map((chunk, index) => ({ id: chunk.id, embedding: vectors[index] }))
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown embedding error";
                result.failed += chunks.length;
                result.failures.push(...chunks.map(chunk => ({ chunkId: chunk.id, error: message })));
                // Avoid an infinite loop: failures remain NULL and will be retried by a later request.
                break;
            }
        }
        return result;
    }

    async embedQuery(query: string): Promise<number[]> {
        const [vector] = await this.provider.embedBatch([query], "query");
        if (!vector) throw new Error("Embedding provider returned no query vector.");
        validateEmbedding(vector);
        return vector;
    }
}
