# Feature: scenario-baseline-partition

## Goal

Give every scenario its own visual baseline. `baselineName` previously
partitioned only by browser/platform/device, so scenarios that render
differently by consent/ads/country/page shared — and overwrote — a single
baseline. This folds the scenario id into the baseline name so each scenario is
independently baselined and reviewable.

## Context and linked canonical specs

- `docs/features/e2e-visual-baseline/SPEC.md` (#77) — introduced the first
  baselines and recorded this collision as a known limitation.
- `src/visual/plan.ts` (`baselineName`, `BaselinePartition`, SPEC-004) and
  `src/orchestrator/run-plan.ts` (`buildVisualRunPlan`) — the change sites.
- `docs/DEMO.md`, `docs/STATUS.md` — the demonstrated run + limitation note.

## Non-goals

- webkit/firefox + CI-linux baselines (separate follow-up).
- Changing the target/threshold/mask model or any execution/API/dashboard code.

## Proposed interfaces and files

- `src/visual/plan.ts`: `BaselinePartition` gains an optional `scenarioId?: string`;
  `baselineName` emits `<targetId>__[<scenarioId>__]<browser>-<platform>-<device>`
  (all slugged). Absent `scenarioId` → the prior name, so existing callers/tests
  are unaffected.
- `src/orchestrator/run-plan.ts`: passes `scenarioId: scenario.id` into the
  partition for every target work item.
- `baselines/desktop-chromium/*` + `baselines/mobile-chromium/*`: the two shared
  baselines are replaced by 8 per-scenario baselines (4 desktop + 4 mobile) of
  the same `example.com` render.
- `baselines/UPDATE_LOG.jsonl`: one reasoned audit line for the repartition.

## Acceptance criteria

- [x] `baselineName` includes the scenario id when supplied and is unchanged
  without it (backward compatible).
- [x] Scenarios differing only by consent/ads get distinct baseline names.
- [x] `buildVisualRunPlan` passes `scenario.id` so each scenario is independently
  baselined.
- [x] The committed `example.com` baselines are repartitioned to 8 per-scenario
  files and a clean run is green (8 passed / 8 skipped, chromium projects).
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit` pass with new
  assertions (scenario-id folding + distinct-variant baselines).

## Test plan

- Unit: `tests/unit/visual-targets.spec.ts` — scenario-id folding + backward
  compatibility; `tests/unit/end-to-end-run-plan.spec.ts` — consent/ads variants
  get distinct baseline names, and the deterministic-name assertions now include
  `scenarioId`.
- Manual (local Chromium via `CHROMIUM_EXECUTABLE_PATH`): regenerate with
  `--update-snapshots`, then a clean run — 8 passed / 8 skipped.

## Security/privacy impact

Baselines remain PNGs of a public static page; the image content is identical to
the already-approved #77 renders — only filenames/count change. Written reason +
human review per `AGENTS.md`. `scenarioId` is a slugged identifier, not secret.

## Baseline impact

Replaces 2 shared baselines with 8 per-scenario baselines (no net visual change).
Future legitimate visual changes still require a written reason and human review.

## Dependencies and risks

- Depends on #77 (merged).
- The committed PNGs remain local Chromium (darwin) renders; the gated `visual`
  CI job stays gated until linux baselines are generated and reviewed there.
