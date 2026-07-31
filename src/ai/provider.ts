export interface VisualAnalysisInput {
  scenarioId: string;
  summary: string;
  expectedImageBase64?: string;
  actualImageBase64?: string;
  diffImageBase64?: string;
}

export interface AiProvider {
  analyzeVisualFailure(input: VisualAnalysisInput): Promise<string>;
}
