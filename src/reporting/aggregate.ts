/**
 * Pure aggregation of `ScenarioResult`s into `RunCounts`, a schema-valid
 * `RunResult`, and a failure grouping by page/category. See
 * docs/specs/SPEC-009-REPORTING.md and docs/features/run-summary/SPEC.md.
 * No fs/Date/random/env; deterministic ordering; never mutates inputs.
 */

import {
  computeDeterministicFailure,
  parseRunResult,
  type NormalizedError,
  type RunCounts,
  type RunManifest,
  type RunResult,
  type ScenarioResult
} from '../domain/index.js';

/** Tally by status; total === passed+failed+skipped === results.length. */
export function computeCounts(results: readonly ScenarioResult[]): RunCounts {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const result of results) {
    if (result.status === 'passed') {
      passed += 1;
    } else if (result.status === 'failed') {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  return { passed, failed, skipped, total: passed + failed + skipped };
}

export interface BuildRunResultInput {
  runId: string;
  startedAt: string;
  finishedAt: string;
  manifest: RunManifest;
  results: readonly ScenarioResult[];
}

/**
 * Assembles counts + `computeDeterministicFailure(results)` and returns a
 * schema-validated RunResult (via `parseRunResult`). Deterministic; preserves
 * input result order.
 */
export function buildRunResult(input: BuildRunResultInput): RunResult {
  const results = [...input.results];
  const candidate = {
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    manifest: input.manifest,
    results,
    counts: computeCounts(results),
    deterministicFailure: computeDeterministicFailure(results)
  };
  return parseRunResult(candidate);
}

export interface FailureItem {
  scenarioId: string;
  device: 'desktop' | 'mobile';
  consent: 'accepted' | 'rejected';
  country: string;
  category: string;
  message: string;
  page: string;
  pageName?: string;
}

export interface PageFailureGroup {
  page: string;
  pageName?: string;
  failures: FailureItem[];
}

export const UNKNOWN_ERROR_CATEGORY = 'unknown_error';
export const NO_NORMALIZED_ERROR_MESSAGE = 'Scenario failed without a normalized error';

/**
 * Single source of truth for "counts as a failure": non-skipped failed
 * results, plus passed results carrying at least one non-warning error.
 * Reused by `groupFailuresByPage` and by `src/reporting/grouping.ts`.
 */
export function countsAsFailure(result: ScenarioResult): boolean {
  if (result.status === 'skipped') {
    return false;
  }
  if (result.status === 'failed') {
    return true;
  }
  return result.errors.some((error: NormalizedError) => error.severity !== 'warning');
}

/** The "probable error": first non-warning error, else the first error. */
export function pickProbableError(errors: readonly NormalizedError[]): NormalizedError | undefined {
  const firstNonWarning = errors.find((error) => error.severity !== 'warning');
  return firstNonWarning ?? errors[0];
}

export function toFailureItem(result: ScenarioResult): FailureItem {
  const probableError = pickProbableError(result.errors);
  const category = probableError?.category ?? UNKNOWN_ERROR_CATEGORY;
  const message = probableError?.message ?? NO_NORMALIZED_ERROR_MESSAGE;

  return {
    scenarioId: result.scenario.id,
    device: result.scenario.device,
    consent: result.scenario.consent,
    country: result.scenario.country,
    category,
    message,
    page: result.scenario.page.path,
    ...(result.scenario.page.name !== undefined ? { pageName: result.scenario.page.name } : {})
  };
}

/**
 * Groups every non-passing result that carries deterministic weight into
 * per-page buckets, ordered by first appearance; within a page, failures
 * keep input order.
 */
export function groupFailuresByPage(results: readonly ScenarioResult[]): PageFailureGroup[] {
  const groups: PageFailureGroup[] = [];
  const groupIndexByPage = new Map<string, number>();

  for (const result of results) {
    if (!countsAsFailure(result)) {
      continue;
    }

    const page = result.scenario.page.path;
    let groupIndex = groupIndexByPage.get(page);

    if (groupIndex === undefined) {
      groupIndex = groups.length;
      groupIndexByPage.set(page, groupIndex);
      groups.push({
        page,
        ...(result.scenario.page.name !== undefined ? { pageName: result.scenario.page.name } : {}),
        failures: []
      });
    }

    groups[groupIndex]!.failures.push(toFailureItem(result));
  }

  return groups;
}
