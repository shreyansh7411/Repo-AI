import type { LLMProvider } from "./llm-provider.js";

interface GeminiResponse { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; error?: { message?: string } }

export class GeminiLLMProvider implements LLMProvider {
    private readonly key = process.env.GEMINI_API_KEY?.trim() ?? "";
    private readonly model = process.env.GEMINI_GENERATION_MODEL ?? "gemini-3.8-flash";
    constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    async generateAnswer(input: { systemInstruction: string; prompt: string }): Promise<string> {
        if (!this.key) throw new Error("GEMINI_API_KEY is not configured.");
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
        for (let attempt = 0; attempt < 3; attempt++) {
            let response: Response;
            try {
                response = await this.fetchImpl(url, {
                    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": this.key },
                    body: JSON.stringify({ system_instruction: { parts: [{ text: input.systemInstruction }] },
                        contents: [{ role: "user", parts: [{ text: input.prompt }] }],
                        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } }),
                    signal: AbortSignal.timeout(60_000)
                });
            } catch {
                if (attempt < 2) { await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1))); continue; }
                throw new Error("Gemini reasoning request failed due to a network error.");
            }
            let body: GeminiResponse;
            try { body = await response.json() as GeminiResponse; }
            catch { throw new Error(`Gemini reasoning provider returned a non-JSON response (HTTP ${response.status}).`); }
            if (!response.ok) {
                const description = (body.error?.message ?? "request rejected").split(this.key).join("[redacted]");
                if ((response.status === 429 || response.status >= 500) && attempt < 2) {
                    await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
                    continue;
                }
                throw new Error(`Gemini reasoning request failed (HTTP ${response.status}): ${description}`);
            }
            const answer = body.candidates?.[0]?.content?.parts?.map(part => part.text ?? "").join("").trim();
            if (!answer) throw new Error("Gemini reasoning provider returned no answer text.");
            return answer;
        }
        throw new Error("Gemini reasoning request failed after retries.");
    }
}
