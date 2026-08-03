/**
 * Barrel for the provider-neutral AI analysis contract (SPEC-008,
 * ADR-003) plus the real Anthropic adapter (feature #27) and its factory.
 */
export * from './analysis.js';
export * from './contract.js';
export * from './disabled-provider.js';
export * from './resolve.js';
export * from './anthropic/index.js';
export * from './factory.js';
