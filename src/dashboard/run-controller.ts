import type { ProjectConfig } from '../config/schema.js';
import { normalizeError, type Scenario } from '../domain/index.js';
import type { RunRequest, RunResult } from '../orchestrator/index.js';
import { JobStore, type RunJob } from './jobs.js';

/**
 * Thin async controller wiring the local dashboard's job model to the
 * injected `executeRun` (docs/features/local-dashboard-runner/SPEC.md). Every
 * side effect (scenario resolution, run execution, clock, id generation) is
 * injected so this module stays testable with fakes — no real fs/net/spawn.
 */

export interface RunControllerDeps {
  resolveScenarios: () => { config: ProjectConfig; scenarios: Scenario[] };
  executeRun: (request: RunRequest, deps?: unknown) => Promise<RunResult>;
  store: JobStore;
  now: () => Date;
  generateJobId: (now: Date) => string;
}

export interface StartRunInput {
  scenarioIds?: string[];
}

export interface StartRunOutcome {
  status: number;
  job?: RunJob;
  error?: string;
}

/**
 * Resolves the server-planned set and validates any requested subset against
 * it. Returns `undefined` (invalid) when any requested id is unknown or the
 * resulting selection would be empty; returns ALL planned scenarios when no
 * subset was requested.
 */
function selectScenarios(
  input: StartRunInput,
  planned: readonly Scenario[]
): Scenario[] | undefined {
  if (input.scenarioIds === undefined) {
    return [...planned];
  }

  const plannedById = new Map(planned.map((scenario) => [scenario.id, scenario]));
  const selected: Scenario[] = [];

  for (const id of input.scenarioIds) {
    const scenario = plannedById.get(id);
    if (!scenario) {
      return undefined;
    }
    selected.push(scenario);
  }

  return selected.length > 0 ? selected : undefined;
}

/**
 * Starts an async run over a validated subset of server-planned scenarios.
 * Single-flight: rejects with 409 while any job is already `running`. The
 * launched `executeRun` is fire-and-forget from the caller's perspective —
 * its settlement (success or failure) is always funneled into the job store
 * via a report-safe, `normalizeError`-guaranteed message, never a raw
 * stack/secret.
 */
export async function startRun(
  input: StartRunInput,
  deps: RunControllerDeps
): Promise<StartRunOutcome> {
  const { config, scenarios } = deps.resolveScenarios();

  const selected = selectScenarios(input, scenarios);
  if (selected === undefined) {
    return { status: 400, error: 'invalid_scenario_selection' };
  }

  if (deps.store.hasActiveRun()) {
    return { status: 409, error: 'run_in_progress' };
  }

  const startedAt = deps.now();
  const id = deps.generateJobId(startedAt);
  deps.store.create(id, startedAt.toISOString(), selected.map((scenario) => scenario.id));

  // Guard against a synchronous throw inside executeRun itself, in addition
  // to an async rejection, so the fire-and-forget promise never escapes as
  // an unhandled rejection.
  Promise.resolve()
    .then(() => deps.executeRun({ config, scenarios: selected }))
    .then((result) => {
      deps.store.complete(
        id,
        { runId: result.runId, counts: result.counts, deterministicFailure: result.deterministicFailure },
        deps.now().toISOString()
      );
    })
    .catch((err) => {
      const normalized = normalizeError(err instanceof Error ? err.message : String(err), {
        category: 'internal_error',
        phase: 'assertion'
      });
      deps.store.fail(id, normalized.message, deps.now().toISOString());
    });

  return { status: 202, job: deps.store.get(id) };
}
