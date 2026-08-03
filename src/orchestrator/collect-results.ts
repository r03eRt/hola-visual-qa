import { normalizeError, parseScenarioResult, type Scenario, type ScenarioResult } from '../domain/index.js';
import type { RawScenarioOutcome } from './raw-outcome.js';

/**
 * PURE join of `RawScenarioOutcome[]` to planned `Scenario[]`, by id, in
 * planned order. A planned scenario with no matching outcome is reported as
 * `skipped` with no errors, using `fallbackTimestamp` for its
 * `startedAt`/`finishedAt` (there is no real timestamp for a scenario that
 * never ran). See docs/features/execution-run-contract/SPEC.md.
 */
export function collectScenarioResults(
  outcomes: readonly RawScenarioOutcome[],
  scenarios: readonly Scenario[],
  fallbackTimestamp: string
): ScenarioResult[] {
  const outcomeById = new Map<string, RawScenarioOutcome>();
  for (const outcome of outcomes) {
    outcomeById.set(outcome.scenarioId, outcome);
  }

  return scenarios.map((scenario) => {
    const outcome = outcomeById.get(scenario.id);

    if (!outcome) {
      const candidate = {
        scenario,
        status: 'skipped' as const,
        errors: [],
        startedAt: fallbackTimestamp,
        finishedAt: fallbackTimestamp,
        durationMs: 0
      };
      return parseScenarioResult(candidate);
    }

    const errors = outcome.errorMessages.map((message) =>
      normalizeError(message, {
        category: 'visual_regression',
        phase: 'assertion',
        scenarioId: scenario.id
      })
    );

    const candidate = {
      scenario,
      status: outcome.status,
      errors,
      startedAt: outcome.startedAt,
      finishedAt: outcome.finishedAt,
      durationMs: outcome.durationMs,
      ...(outcome.artifacts ? { artifacts: outcome.artifacts } : {})
    };
    return parseScenarioResult(candidate);
  });
}
