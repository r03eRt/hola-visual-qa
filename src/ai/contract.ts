import { normalizeError, type NormalizedError } from '../domain/error.js';
import type { RedactedEvidence } from '../evidence/contract.js';
import type { AiAnalysis } from './analysis.js';

/**
 * Provider-neutral AI analysis port (ADR-003). Concrete providers (e.g. the
 * Anthropic adapter, feature #27) implement `AiProvider` against this
 * contract only — no network/SDK types leak in here.
 */

/** Resolved cost/size/timeout/retry limits applied to every analysis call. */
export interface AiRequestOptions {
  timeoutMs: number;
  maxOutputTokens: number;
  maxAttempts: number;
  maxCostUsd: number;
}

export interface AiAnalysisRequest {
  evidence: RedactedEvidence;
  options: AiRequestOptions;
}

export interface AiProvider {
  readonly name: string;
  analyze(request: AiAnalysisRequest): Promise<AiAnalysis>;
}

/**
 * Normalized, report-safe error thrown/rejected by any `AiProvider`. Never
 * carries raw evidence — only a report-safe `message` derived via
 * `normalizeError`, matching the `ai_provider_error` category/warning
 * severity contract in `src/domain/error.ts`.
 */
export class AiProviderError extends Error {
  readonly code: string;
  readonly category: string;
  readonly normalized: NormalizedError;

  constructor(message: string, options?: { scenarioId?: string }) {
    super(message);
    this.name = 'AiProviderError';
    this.normalized = normalizeError(message, {
      category: 'ai_provider_error',
      phase: 'ai_analysis',
      scenarioId: options?.scenarioId
    });
    this.code = this.normalized.code;
    this.category = this.normalized.category;
  }
}
