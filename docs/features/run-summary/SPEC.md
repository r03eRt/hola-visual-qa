# Feature SPEC — run-summary (#13)

Ticket: #27 · Branch: `feature/run-summary` · Roadmap: Browser MVP
Canonical: `docs/specs/SPEC-009-REPORTING.md`

## Goal
A PURE reporting/aggregation layer that turns a set of `ScenarioResult`s +
run metadata into: `RunCounts`, a validated `RunResult`, a failure grouping by
page and probable category, a concise CLI summary string, and the correct
process exit code (nonzero iff a deterministic failure occurred). No browser,
no fs, no secrets. Additive; reuses existing domain + artifacts helpers.

## Non-goals
- Writing files (the artifacts writer from #5 does that) or building the HTML
  report (later). AI-content rendering (later; must work with AI disabled).
- Editing `src/domain`, `src/artifacts`, `src/config`, `playwright.config.ts`.
  REUSE `computeDeterministicFailure`, `parseRunResult`, `RunResult`,
  `RunCounts`, `ScenarioResult`, `RunManifest` from `src/domain`, and
  `buildRunSummary` from `src/artifacts`.

## New files (only these)
- `src/reporting/aggregate.ts`
- `src/reporting/cli-summary.ts`
- `src/reporting/index.ts` — barrel (`export *`).
- `tests/unit/run-summary.spec.ts` — hermetic tests over `ScenarioResult` fixtures.
- `docs/STATUS.md` — one honest row.

## Aggregation — `aggregate.ts`
```ts
import type { RunCounts, RunResult, RunManifest, ScenarioResult } from '../domain/index.js';

/** Tally by status; total === passed+failed+skipped === results.length. */
export function computeCounts(results: readonly ScenarioResult[]): RunCounts;

export interface BuildRunResultInput {
  runId: string;
  startedAt: string;        // ISO
  finishedAt: string;       // ISO
  manifest: RunManifest;
  results: readonly ScenarioResult[];
}
/**
 * Assembles counts + `computeDeterministicFailure(results)` and returns a
 * schema-validated RunResult (via `parseRunResult`). Deterministic; preserves
 * input result order.
 */
export function buildRunResult(input: BuildRunResultInput): RunResult;

export interface FailureItem {
  scenarioId: string;
  device: 'desktop' | 'mobile';
  consent: 'accepted' | 'rejected';
  country: string;
  category: string;        // probable category (see rule below)
  message: string;         // the chosen error's report-safe message
}
export interface PageFailureGroup {
  page: string;            // scenario.page.path
  pageName?: string;       // scenario.page.name when present
  failures: FailureItem[];
}
/**
 * Groups every non-passing result that carries deterministic weight into
 * per-page buckets, ordered by first appearance; within a page, failures keep
 * input order. Only results that count as failures are included (status
 * 'failed' OR any error with severity !== 'warning'); 'skipped' and clean
 * 'passed' are excluded. The "probable category" is the category of the FIRST
 * error whose severity !== 'warning' if any, else the first error's category,
 * else 'unknown_error'. `message` is that same error's message (already
 * report-safe/redacted upstream); when a failed result has no errors, use
 * category 'unknown_error' and a fixed message 'Scenario failed without a
 * normalized error'.
 */
export function groupFailuresByPage(results: readonly ScenarioResult[]): PageFailureGroup[];
```
Rules: pure — no fs/Date/random/env; do not mutate inputs; deterministic
ordering. `category` values must be plain strings copied from the domain error
category (do not invent new categories except the documented 'unknown_error'
fallback).

## CLI summary — `cli-summary.ts`
```ts
import type { RunResult } from '../domain/index.js';

/**
 * One concise, multi-line, secret-free human summary, e.g.:
 *   Run <runId>: <passed> passed, <failed> failed, <skipped> skipped (<total> total)
 *   Result: FAIL (deterministic)      // or: Result: PASS
 *   Failures by page:
 *     <page> [<pageName>]: <n> (<category>, <category>...)
 * When there are no failures, omit the "Failures by page" block.
 */
export function formatCliSummary(run: RunResult): string;

/** 0 when run.deterministicFailure is false, else 1. */
export function exitCodeForRun(run: RunResult): number;
```
`formatCliSummary` must never print artifact contents, headers, cookies or
URLs with query strings — only ids, counts, page paths, category names and the
already-redacted messages. Prefer NOT printing raw messages in the summary
(list categories); if a message is printed it is the upstream-redacted one.

## Acceptance criteria (SPEC-009)
- `computeCounts` tallies passed/failed/skipped and `total` equals the sum and
  the input length.
- `buildRunResult` returns a schema-valid RunResult whose `deterministicFailure`
  matches `computeDeterministicFailure` (an all-warning 'passed' set stays
  PASS; any hard failure flips it to FAIL).
- `groupFailuresByPage` buckets failures by page in first-seen order, picks the
  probable category per the rule, excludes skipped/clean-passed, and handles a
  failed-with-no-errors result via the documented fallback.
- `exitCodeForRun` is 0 on a clean run and 1 when there is a deterministic
  failure; AI-only warnings do NOT produce a nonzero exit.
- The CLI summary is deterministic and secret-free.

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
- Hermetic: build `ScenarioResult`/`RunManifest` fixtures in-test (use
  `normalizeError` from `src/domain` to make errors); NO browser, NO fs. Do NOT
  run the visual suite.
