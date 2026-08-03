import type { RawScenarioOutcome } from './raw-outcome.js';

/**
 * PURE mapping from a parsed Playwright JSON-reporter report object to
 * `RawScenarioOutcome[]`. Never touches fs/spawn. Tolerant of missing/extra
 * fields (guarded with `typeof` checks) so a shape drift in the Playwright
 * reporter never throws here. See
 * docs/features/execution-run-contract/SPEC.md.
 */

type RawScenarioStatus = RawScenarioOutcome['status'];

/** Ordinal weight used to collapse multiple results for the same scenario:
 * a non-skipped result always wins over skipped, and among non-skipped
 * results a failure wins over a pass (so a scenario that failed in any
 * project/test is reported as failed overall). */
const STATUS_WEIGHT: Record<RawScenarioStatus, number> = {
  skipped: 0,
  passed: 1,
  failed: 2
};

function mapStatus(rawStatus: unknown): RawScenarioStatus | undefined {
  if (typeof rawStatus !== 'string') {
    return undefined;
  }
  switch (rawStatus) {
    case 'passed':
      return 'passed';
    case 'failed':
    case 'timedOut':
    case 'interrupted':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default:
      return undefined;
  }
}

/** Fallback ISO timestamp used only when the report omits `startTime`. */
const EPOCH_ISO = new Date(0).toISOString();

function extractErrorMessages(rawResult: Record<string, unknown>): string[] {
  const errors = rawResult['errors'];
  if (!Array.isArray(errors)) {
    return [];
  }
  const messages: string[] = [];
  for (const entry of errors) {
    if (entry !== null && typeof entry === 'object' && typeof (entry as Record<string, unknown>)['message'] === 'string') {
      messages.push((entry as Record<string, unknown>)['message'] as string);
    }
  }
  return messages;
}

function toOutcomeCandidate(scenarioId: string, rawResult: unknown): RawScenarioOutcome | undefined {
  if (rawResult === null || typeof rawResult !== 'object') {
    return undefined;
  }
  const record = rawResult as Record<string, unknown>;
  const status = mapStatus(record['status']);
  if (!status) {
    return undefined;
  }

  const durationMs = typeof record['duration'] === 'number' && Number.isFinite(record['duration']) ? (record['duration'] as number) : 0;
  const startedAt = typeof record['startTime'] === 'string' && record['startTime'].length > 0 ? record['startTime'] : EPOCH_ISO;

  const startedAtMs = Date.parse(startedAt);
  const finishedAt = Number.isFinite(startedAtMs) ? new Date(startedAtMs + durationMs).toISOString() : startedAt;

  return {
    scenarioId,
    status,
    startedAt,
    finishedAt,
    durationMs,
    errorMessages: extractErrorMessages(record)
  };
}

/** Recursively collects every `.specs[]` entry from a suite tree. */
function collectSpecs(node: unknown, out: unknown[]): void {
  if (node === null || typeof node !== 'object') {
    return;
  }
  const record = node as Record<string, unknown>;

  if (Array.isArray(record['specs'])) {
    out.push(...(record['specs'] as unknown[]));
  }
  if (Array.isArray(record['suites'])) {
    for (const suite of record['suites'] as unknown[]) {
      collectSpecs(suite, out);
    }
  }
}

/**
 * Maps a parsed Playwright JSON report to `RawScenarioOutcome[]`, collapsed
 * per scenarioId (spec title) across every project/test/result. Order is
 * deterministic: first-seen scenarioId.
 */
export function parsePlaywrightReport(report: unknown): RawScenarioOutcome[] {
  const specs: unknown[] = [];
  collectSpecs(report, specs);

  const order: string[] = [];
  const best = new Map<string, { weight: number; outcome: RawScenarioOutcome }>();

  for (const spec of specs) {
    if (spec === null || typeof spec !== 'object') {
      continue;
    }
    const specRecord = spec as Record<string, unknown>;
    const scenarioId = specRecord['title'];
    if (typeof scenarioId !== 'string' || scenarioId.length === 0) {
      continue;
    }

    const tests = Array.isArray(specRecord['tests']) ? (specRecord['tests'] as unknown[]) : [];
    for (const testEntry of tests) {
      if (testEntry === null || typeof testEntry !== 'object') {
        continue;
      }
      const results = (testEntry as Record<string, unknown>)['results'];
      if (!Array.isArray(results)) {
        continue;
      }

      for (const rawResult of results) {
        const candidate = toOutcomeCandidate(scenarioId, rawResult);
        if (!candidate) {
          continue;
        }

        if (!order.includes(scenarioId)) {
          order.push(scenarioId);
        }

        const weight = STATUS_WEIGHT[candidate.status];
        const existing = best.get(scenarioId);
        if (!existing || weight > existing.weight) {
          best.set(scenarioId, { weight, outcome: candidate });
        }
      }
    }
  }

  return order.map((scenarioId) => best.get(scenarioId)!.outcome);
}
