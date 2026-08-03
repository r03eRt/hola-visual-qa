import { AiProviderError, type AiAnalysisRequest, type AiProvider } from './contract.js';
import type { AiAnalysis } from './analysis.js';

/**
 * The safe default provider used whenever AI is disabled (the default
 * policy). `analyze()` always rejects with a normalized, evidence-free
 * error — it never inspects or echoes the request's evidence.
 */
export class DisabledAiProvider implements AiProvider {
  readonly name = 'none';

  analyze(request: AiAnalysisRequest): Promise<AiAnalysis> {
    void request;
    return Promise.reject(new AiProviderError('AI analysis is disabled'));
  }
}
