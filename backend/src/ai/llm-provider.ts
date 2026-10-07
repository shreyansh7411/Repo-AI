export interface LLMProvider {
    generateAnswer(input: { systemInstruction: string; prompt: string }): Promise<string>;
}
