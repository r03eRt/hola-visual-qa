import type { AiPolicy } from '../config/schema.js';
import type { AiRequestOptions } from './contract.js';

/**
 * Pure mapping from the config `ai` policy to resolved request limits/flags.
 * No fs/Date/random/env — `AiPolicySchema` (src/config/schema.ts) is the
 * single source of the default values themselves; this module only reads
 * the already-defaulted `AiPolicy` fields.
 */
export function resolveAiRequestOptions(policy: AiPolicy): AiRequestOptions {
  return {
    timeoutMs: policy.timeoutMs,
    maxOutputTokens: policy.maxOutputTokens,
    maxAttempts: policy.maxAttempts,
    maxCostUsd: policy.maxCostUsd
  };
}

/** True iff AI analysis is enabled and a real provider is configured. */
export function isAiEnabled(policy: AiPolicy): boolean {
  return policy.enabled && policy.provider !== 'none';
}
