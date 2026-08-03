import type { ArtifactRefs } from '../domain/index.js';

/**
 * Playwright-agnostic per-scenario outcome, the intermediate shape between a
 * raw Playwright JSON report and a schema-valid domain `ScenarioResult`. See
 * docs/features/execution-run-contract/SPEC.md.
 */
export interface RawScenarioOutcome {
  scenarioId: string;
  status: 'passed' | 'failed' | 'skipped';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorMessages: readonly string[];
  artifacts?: ArtifactRefs;
}
