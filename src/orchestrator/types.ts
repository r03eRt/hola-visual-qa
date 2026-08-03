import type { ProjectConfig } from '../config/schema.js';
import type { RunResult as DomainRunResult, Scenario } from '../domain/index.js';

/**
 * Public request contract for `executeRun`. See
 * docs/features/execution-run-contract/SPEC.md — replaces the prototype
 * `{ command, scenarioIds, exitCode }` shape previously defined here.
 */
export interface RunRequest {
  config: ProjectConfig;
  scenarios: readonly Scenario[];
  updateSnapshots?: boolean;
}

/** The orchestrator's result type is the schema-valid domain `RunResult`. */
export type RunResult = DomainRunResult;
