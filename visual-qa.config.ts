import type { ProjectConfigInput } from './src/config/schema.js';

/**
 * Committed, non-secret example/default project configuration.
 *
 * This file must never contain credentials, API keys or other secrets — those
 * belong in `.env` and are validated separately by `src/config/env.ts`.
 */
const config: ProjectConfigInput = {
  schemaVersion: 1,
  projectName: 'hola-visual-qa',
  baseUrl: 'https://example.com',
  allowedHosts: ['example.com'],
  pages: [{ path: '/', name: 'home' }],
  dimensions: {
    device: ['desktop', 'mobile'],
    consent: ['accepted', 'rejected'],
    country: ['ES'],
    ads: [true, false]
  }
};

export default config;
