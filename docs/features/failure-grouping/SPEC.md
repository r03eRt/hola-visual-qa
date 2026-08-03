# Feature: failure-grouping

## Goal

Provide a pure failure-grouping engine (SPEC-009: the report "groups failures by
page and probable category") layered on the existing `groupFailuresByPage`:
group failures **by probable category**, **by page-and-category** (nested), and
a run-level **failure summary** (tallies by category and by page). Deterministic
ordering throughout; a single shared definition of "counts as a failure" and
"probable error".

## Context and linked canonical specs

- `docs/specs/SPEC-009-REPORTING.md` — failures grouped by page AND probable
  category.
- `src/reporting/aggregate.ts` — existing `groupFailuresByPage()`,
  `PageFailureGroup`, `FailureItem`, and the (currently private)
  `countsAsFailure`/`pickProbableError`/`toFailureItem` helpers.
- `src/domain/result.ts` / `error.ts` — `ScenarioResult`, `NormalizedError`
  (`category` is the taxonomy reused here).

## Non-goals

- No change to `groupFailuresByPage`'s existing signature/behaviour.
- No rewiring of the HTML report (#28) or CLI summary — that is a later,
  separate change (kept out to stay one-capability-per-PR).
- No new categorization taxonomy — reuse `NormalizedError.category`.
- No orchestrator/dashboard work.

## Proposed interfaces and files

- Refactor `src/reporting/aggregate.ts` to make the failure-derivation logic a
  single source of truth reused by both groupers, WITHOUT changing existing
  public behaviour:
  - Extend `FailureItem` with `page: string` and optional `pageName?: string`
    (additive — existing consumers read `scenarioId`/`category`/`message` only).
  - Set `page`/`pageName` inside `toFailureItem` from the scenario.
  - EXPORT `countsAsFailure`, `pickProbableError`, `toFailureItem` (so the new
    module shares one definition), or move them into a tiny internal
    `src/reporting/failure-item.ts` re-exported by `aggregate.ts`.
- `src/reporting/grouping.ts` (PURE, no fs/Date/random; never mutates inputs):
  - `groupFailuresByCategory(results: readonly ScenarioResult[]):
    CategoryFailureGroup[]` — one bucket per probable category, ordered by
    DESCENDING failure count then first-appearance for ties; within a bucket,
    failures keep input order. `CategoryFailureGroup = { category: string;
    failures: FailureItem[] }`.
  - `groupFailuresByPageAndCategory(results): PageCategoryGroup[]` — page buckets
    in first-seen order, each with `categories: CategoryFailureGroup[]` ordered
    by descending count then first-appearance within that page. `PageCategoryGroup
    = { page: string; pageName?: string; categories: CategoryFailureGroup[];
    total: number }`.
  - `summarizeFailures(results): FailureSummary` —
    `{ total: number; byCategory: CategoryTally[]; byPage: PageTally[] }` where
    `CategoryTally = { category: string; count: number }` (desc count then
    first-appearance) and `PageTally = { page: string; pageName?: string; count:
    number }` (first-seen order). `total` = number of results that count as a
    failure.
- `src/reporting/index.ts` — export the new `grouping.ts` module.

## Acceptance criteria

- [x] `groupFailuresByPage` behaviour is unchanged (existing tests still pass);
      `FailureItem` gains `page`/`pageName` additively.
- [x] `groupFailuresByCategory` buckets by probable category, ordered by
      descending count with first-appearance tie-break; failures keep input
      order within a bucket.
- [x] `groupFailuresByPageAndCategory` nests categories under first-seen pages,
      each page's categories ordered by descending count then first-appearance,
      with a correct per-page `total`.
- [x] `summarizeFailures` totals equal the number of failing results and match
      the sum of category counts and of page counts; ordering is deterministic.
- [x] All groupers ignore skipped and clean-passed results and include
      passed-with-non-warning-error and failed results, using the SAME
      `countsAsFailure`/`pickProbableError` as `groupFailuresByPage`.
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit` green.

## Test plan

- `tests/unit/failure-grouping.spec.ts` — category ordering by count with a
  first-appearance tie-break; page-and-category nesting + per-page totals;
  `summarizeFailures` invariants (total == failing count == sum of category
  counts == sum of page counts); exclusion of skipped/clean-passed and inclusion
  of passed-with-hard-error; `FailureItem.page`/`pageName` populated.
- Confirm existing `tests/unit/run-summary.spec.ts` still passes unchanged.
- Hermetic; placeholders only.

## Security/privacy impact

None. Pure aggregation of already-normalized, redacted domain results — no
secrets, no egress, no fs. (Issue is `type:feature` only.)

## Baseline impact

None.

## Dependencies and risks

- Builds on `src/reporting/aggregate.ts` and `src/domain`. Low risk; the only
  cross-cutting change is the additive `FailureItem` field and exporting shared
  helpers.

## Handover notes

Execute with Sonnet against this spec. Keep everything pure and reuse the
existing failure-derivation helpers as the single source of truth (do not
re-implement "counts as a failure"). After implementation: independent review,
then update `docs/STATUS.md` (new "Failure grouping" row) and check the boxes.
