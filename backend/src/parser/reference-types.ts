export interface ExtractedReference {
    sourceSymbol: string;
    targetName: string;
    type: "CALLS";
    filePath: string;
    line: number;
}
