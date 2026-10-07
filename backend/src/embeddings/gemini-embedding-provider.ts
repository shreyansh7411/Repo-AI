import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "./types.js";

interface GeminiEmbeddingResponse {
    embeddings?: Array<{ values?: number[] }>;
    error?: { message?: string; status?: string };
}

function retryDelayMs(response: Response, payload: GeminiEmbeddingResponse, attempt: number): number {
    const retryAfter = response.headers.get("retry-after");
    let indicatedMs = 0;
    if (retryAfter) {
        const seconds = Number(retryAfter);
        indicatedMs = Number.isFinite(seconds)
            ? seconds * 1000
            : Math.max(0, Date.parse(retryAfter) - Date.now());
    }
    const retryMessage = payload.error?.message?.match(/retry in\s+((?:\d+h)?(?:\d+m)?[\d.]+s)/i);
    if (retryMessage) {
        const duration = retryMessage[1].match(/(?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/i);
        if (duration) {
            indicatedMs = Math.max(indicatedMs,
                ((Number(duration[1] ?? 0) * 3600) + (Number(duration[2] ?? 0) * 60) + Number(duration[3])) * 1000);
        }
    }
    return Math.max(250 * (attempt + 1), indicatedMs + (indicatedMs ? 500 : 0));
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
    private readonly apiKey: string;
    private readonly model: string;
    private readonly fetchImpl: typeof fetch;

    constructor(options: { apiKey?: string; model?: string; fetchImpl?: typeof fetch } = {}) {
        this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY?.trim() ?? "";
        this.model = options.model ?? process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2";
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    async embedBatch(texts: string[], purpose: "document" | "query" = "document"): Promise<number[][]> {
        if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured.");
        if (texts.length === 0) return [];
        const model = `models/${this.model}`;
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/${model}:batchEmbedContents`;
        for (let attempt = 0; attempt < 3; attempt++) {
            let response: Response;
            try {
                response = await this.fetchImpl(endpoint, {
                    method: "POST",
                    headers: {
                        "x-goog-api-key": this.apiKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        requests: texts.map(text => ({
                            model,
                            content: {
                                parts: [{
                                    text: purpose === "query"
                                        ? `task: code retrieval | query: ${text}`
                                        : `title: code chunk | text: ${text}`
                                }]
                            },
                            embedContentConfig: { outputDimensionality: EMBEDDING_DIMENSIONS }
                        }))
                    }),
                    signal: AbortSignal.timeout(45_000)
                });
            } catch (error) {
                if (attempt === 2) {
                    const message = error instanceof Error ? error.message : "network error";
                    throw new Error(`Gemini embedding request failed: ${this.safeMessage(message)}`);
                }
                await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
                continue;
            }

            let payload: GeminiEmbeddingResponse;
            try {
                payload = await response.json() as GeminiEmbeddingResponse;
            } catch {
                throw new Error(`Gemini embedding provider returned a non-JSON response (HTTP ${response.status}).`);
            }
            if (!response.ok) {
                const details = payload.error?.message;
                const message = `Gemini embedding request failed (HTTP ${response.status})` +
                    (details ? `: ${this.safeMessage(details)}` : ".");
                if ((response.status === 429 || response.status >= 500) && attempt < 2) {
                    const delay = retryDelayMs(response, payload, attempt);
                    if (delay > 120_000) throw new Error(message);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw new Error(message);
            }
            const embeddings = payload.embeddings;
            if (!embeddings || embeddings.length !== texts.length ||
                embeddings.some(item => !Array.isArray(item.values))) {
                throw new Error("Gemini embedding provider returned an unexpected response shape.");
            }
            return embeddings.map(item => item.values as number[]);
        }
        throw new Error("Gemini embedding request failed after retries.");
    }

    private safeMessage(message: string): string {
        return this.apiKey ? message.split(this.apiKey).join("[redacted]") : message;
    }
}
