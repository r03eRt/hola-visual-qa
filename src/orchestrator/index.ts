/**
 * Public barrel for `src/orchestrator`. See
 * docs/features/execution-run-contract/SPEC.md.
 */
export type { RunRequest, RunResult } from './types.js';
export { executeRun, type ExecuteRunDeps } from './run.js';
export { collectScenarioResults } from './collect-results.js';
export { parsePlaywrightReport } from './playwright-report.js';
export type { RawScenarioOutcome } from './raw-outcome.js';
export { buildVisualRunPlan } from './run-plan.js';
export type { BuildRunPlanInput, ScenarioWorkItem, TargetWorkItem, VisualRunPlan } from './run-plan.js';
