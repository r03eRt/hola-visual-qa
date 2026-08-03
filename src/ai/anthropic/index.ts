/**
 * Barrel for the Anthropic (Claude) adapter (ADR-003, SPEC-008, feature
 * #27). `real-client.ts` and `fs-image-loader.ts` are the only I/O-bound
 * modules here; everything else is pure or DI-based and hermetically
 * testable.
 */
export * from './client-port.js';
export * from './image-port.js';
export * from './prompt.js';
export * from './parse.js';
export * from './provider.js';
export * from './real-client.js';
export * from './fs-image-loader.js';
