/**
 * Barrel for the provider-neutral AI analysis contract (SPEC-008,
 * ADR-003). The legacy prototypes `src/ai/{provider,anthropic-provider,
 * factory}.ts` predate this contract and are intentionally NOT re-exported
 * here; they remain untouched and unused.
 */
export * from './analysis.js';
export * from './contract.js';
export * from './disabled-provider.js';
export * from './resolve.js';
