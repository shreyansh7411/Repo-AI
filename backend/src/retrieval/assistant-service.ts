import type { LLMProvider } from "../ai/llm-provider.js";
import type { HybridRetrievalService } from "./hybrid-retrieval-service.js";
import { buildGroundedPrompt } from "./grounded-prompt.js";
import type { Citation, RetrievalResult } from "./types.js";

export interface AskResult {
    repositoryId: string;
    question: string;
    answer: string;
    citations: Citation[];
    evidence: RetrievalResult["evidence"];
    insufficientEvidence: boolean;
    semanticAvailable: boolean;
}

export class AssistantService {
    constructor(private readonly retrieval: HybridRetrievalService, private readonly llm: LLMProvider) {}

    async ask(repositoryId: string, question: string, options: { topK?: number; maxDepth?: number } = {}): Promise<AskResult> {
        const result = await this.retrieval.retrieve(repositoryId, question, options);
        const citations = result.evidence.filter(item => item.kind === "CHUNK").map(item => ({
            filePath: item.filePath, startLine: item.startLine, endLine: item.endLine,
            symbol: item.symbol, evidenceId: item.id
        }));
        if (!result.evidence.length) return { repositoryId, question,
            answer: "I couldn't find enough evidence in this repository to answer that.", citations, evidence: [], insufficientEvidence: true, semanticAvailable: false };
        const prompt = buildGroundedPrompt(question, result.evidence, result.context);
        const answer = await attachTrustedCitations(this.llm, prompt, result.evidence, citations);
        return { repositoryId, question, answer, citations, evidence: result.evidence, insufficientEvidence: false, semanticAvailable: result.semantic.length > 0 };
    }
}

async function attachTrustedCitations(llm: LLMProvider, prompt: ReturnType<typeof buildGroundedPrompt>,
    evidence: RetrievalResult["evidence"], citations: Citation[]): Promise<string> {
    const raw = await llm.generateAnswer(prompt);
    const allowedIds = new Set(evidence.map(item => item.id));
    const safe = raw
        .replace(/\[(?:chunk|relationship):[0-9a-f-]+\]/gi, id => allowedIds.has(id.slice(1, -1)) ? id : "")
        .replace(/\b[\w.-]+\.(?:java|jsx?|tsx?)(?::\d+(?:\s*[-–,]\s*\d+)*)?/gi, "")
        .replace(/[ \t]{2,}/g, " ").trim();
    const sourceLines = citations.slice(0, 10).map((citation, index) =>
        `- [${index + 1}]${citation.symbol ? ` ${citation.symbol}` : ""} — ${citation.filePath}:${citation.startLine}-${citation.endLine}`);
    return `${safe}\n\nVerified sources:\n${sourceLines.join("\n")}`;
}
