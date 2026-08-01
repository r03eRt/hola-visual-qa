# Feature SPEC — end-to-end-run (wiring / demo-enabler)

Ticket: #29 · Branch: `feature/end-to-end-run` · Milestone: Browser MVP wiring
Canonical: SPEC-001/002/003/004/005/009 + `docs/architecture/DATA_FLOW.md`

## Why
Every Browser MVP module (#4–#13) exists but nothing runs end to end. This
feature wires them into a runnable visual QA flow and RETIRES the legacy
scaffold that the new modules supersede. It is the prerequisite for the visual
demo (run against a URL → screenshot comparison + summary).

## Deliverables
### 1) PURE run-plan builder — `src/orchestrator/run-plan.ts` (hermetic, unit-tested)
```ts
import type { ProjectConfig } from '../config/schema.js';
import type { Scenario } from '../domain/index.js';
import type { ReadinessPolicy } from '../stability/index.js';
import type { VisualTarget } from '../visual/index.js';

export interface TargetWorkItem {
  target: VisualTarget;
  baselineName: string;   // baselineName(target, partition) from src/visual
}
export interface ScenarioWorkItem {
  scenario: Scenario;
  url: string;            // config.baseUrl joined with scenario.page.path (no double slash)
  readiness: ReadinessPolicy;   // readinessPolicyFromConfig(config)
  targets: TargetWorkItem[];    // at least the full-page target
}
export interface VisualRunPlan { workItems: ScenarioWorkItem[]; }

export interface BuildRunPlanInput {
  config: ProjectConfig;
  scenarios: readonly Scenario[];   // caller passes planScenarios(config) output
  /** Optional extra targets beyond the default full-page (e.g. viewport). */
  targetsFor?: (scenario: Scenario) => VisualTarget[];
}
export function buildVisualRunPlan(input: BuildRunPlanInput): VisualRunPlan;
```
Rules (PURE — no fs/Date/random/env, no browser, deterministic, input order
preserved):
- `url` = join `config.baseUrl` + `scenario.page.path` safely (exactly one `/`
  between; keep query/hash of path if present; never throw on a normal path).
- `readiness` = `readinessPolicyFromConfig(config)`.
- Default target = `{ kind: 'full-page' }`; if `targetsFor` supplied, use its
  list (must be non-empty; else fall back to full-page).
- `baselineName` via `baselineName(target, { browser: 'chromium', platform:
  'ci', device: scenario.device })` — keep the partition fields deterministic
  and documented; the real per-project partition is applied by the Playwright
  project at snapshot time, so here use a stable logical partition.
  (Use `targetId`+`baselineName` from `src/visual`.)

### 2) Playwright-driven visual harness — `tests/visual/scenarios.spec.ts` (NEW; replaces homepage.spec.ts)
Consumes the plan and wires the REAL new modules. For each scenario, generate a
`test(scenario.id, ...)` that:
- Skips when the Playwright project device doesn't match `scenario.device`
  (mirror the legacy `test.skip(project.name.startsWith('desktop') !==
  (scenario.device === 'desktop'), ...)`).
- Builds the cookie consent adapter (`createCookieConsentAdapter(scenario,
  config)`), `await adapter.apply(context)` BEFORE navigation.
- Attaches the new diagnostics collector: `createDiagnosticsCollector(page,
  config.diagnostics)` (its snapshot may be attached to `testInfo` on failure —
  optional, keep secret-free).
- `await page.goto(workItem.url, { waitUntil: 'domcontentloaded' })`.
- `await preparePage(page, workItem.readiness)` (readiness policy).
- Verifies consent: `const report = await verifyConsentState(page, adapter);
  assertConsentState(report, adapter.describeRedacted())` — but ONLY assert when
  the app actually shows a CMP; since the target site is unknown, wrap the
  verify/assert so a missing-banner site does not spuriously fail: verify, and
  assert only the cookie signal is satisfied (do NOT hard-fail purely on banner
  visibility for an unknown site). Keep this pragmatic and documented in a
  comment; the deterministic screenshot remains authoritative.
- For each `TargetWorkItem`, `await expect(page).toHaveScreenshot(
  `${item.baselineName}.png`, { fullPage: item.target.kind === 'full-page',
  maxDiffPixelRatio: config.visual.maxDiffPixelRatio, animations:
  config.visual.animations, mask: workItem.readiness.maskSelectors.map(s =>
  page.locator(s)) })`. For a component/ad-placement target, clip via
  `page.locator(target.selector)` instead of fullPage.
- Config is loaded once via `loadConfig()`; scenarios via `planScenarios(config)`
  filtered by `process.env.VISUAL_SCENARIOS` (comma list) when set — mirror the
  legacy filtering. Build the plan with `buildVisualRunPlan`.

### 3) Committed baseline store wiring — `playwright.config.ts`
Add `snapshotPathTemplate: 'baselines/{projectName}/{arg}{ext}'` so
`toHaveScreenshot('<baselineName>.png')` reads/writes the committed `baselines/`
store from #11. Do not change projects/expect thresholds otherwise.

### 4) Retire the legacy scaffold (reconciliation)
DELETE the now-superseded legacy files and update the only remaining importer:
- Delete `tests/visual/homepage.spec.ts` (replaced by scenarios.spec.ts).
- Delete `src/scenarios/scenarios.ts`, `src/consent/consent-manager.ts`,
  `src/stability/prepare-page.ts` (superseded by planner / cookie-adapter+
  state-verifier / readiness). FIRST grep the repo to confirm no OTHER file
  imports them; the known importers are the legacy orchestrator + homepage.spec.
- Update `src/orchestrator/orchestrator.ts` / `cli.ts` (`npm run orchestrate`)
  to plan via `loadConfig()` + `planScenarios` + `buildVisualRunPlan` and spawn
  `playwright test tests/visual` (keep passing selected scenario ids through
  `VISUAL_SCENARIOS`, keep `--update` support). It must still typecheck and run.
  Keep the legacy `src/orchestrator/types.ts` shapes or adapt as needed.
- Retire the now-legacy `collectDiagnostics` in `src/diagnostics/collector.ts`
  ONLY IF nothing imports it after homepage.spec.ts is deleted; otherwise leave
  it. (Prefer leaving it untouched to keep the diff focused.)

### 5) Demo instructions — `docs/DEMO.md` (new) + `docs/STATUS.md` row
`docs/DEMO.md`: exact steps to run the visual demo — set a QA base URL
(`BASE_URL` locally / `QA_BASE_URL` secret in CI), seed baselines the first time
via the gated `visual` workflow_dispatch run with `--update-snapshots` (a
REVIEWED baseline commit), then re-run to get pass/fail + `summary.json`. State
clearly that the local macOS sandbox cannot launch page renderers, so the real
run happens in CI or on an unrestricted machine. Update `docs/STATUS.md`
honestly (end-to-end wiring present; visual run is CI/unrestricted-only; demo
needs a QA URL + reviewed baselines).

## New/changed files (allowed set)
NEW: `src/orchestrator/run-plan.ts`, `tests/visual/scenarios.spec.ts`,
`tests/unit/end-to-end-run-plan.spec.ts`, `docs/DEMO.md`.
CHANGED: `playwright.config.ts` (snapshotPathTemplate), `src/orchestrator/
orchestrator.ts` + `cli.ts` (use new planner), `docs/STATUS.md`.
DELETED: `tests/visual/homepage.spec.ts`, `src/scenarios/scenarios.ts`,
`src/consent/consent-manager.ts`, `src/stability/prepare-page.ts`.
Do NOT modify config/domain schemas, or the already-shipped module internals
(scenarios/planner, artifacts, browser, consent adapter/state-verifier,
stability readiness, visual, baseline, diagnostics collector, reporting).

## Verification
- `npm run typecheck`, `npm run lint`, `npm run test:unit` all exit 0. The unit
  suite covers `buildVisualRunPlan` hermetically (URL join incl. trailing/no
  slash + path with query; default full-page target; baseline name determinism;
  readiness wiring; input order). The Playwright visual spec is TYPE-CHECKED but
  NOT executed by required CI jobs (it needs baselines + a real browser); it
  runs only in the gated `visual` job / on an unrestricted machine.
- Confirm `tests/integration` (#6 smoke) still passes shape (do not break it).
- Do NOT run the visual suite locally (sandbox cannot render pages).

## Acceptance criteria
- `buildVisualRunPlan` deterministically expands a scenario list into work
  items with correct joined URLs, a full-page target + baseline name each, and
  the config-derived readiness policy — proven by hermetic unit tests.
- The visual harness typechecks and wires ONLY the new modules (no legacy
  imports remain anywhere in the repo).
- The legacy scaffold files are deleted and nothing imports them (grep clean).
- `npm run orchestrate` still works (plans via the new planner).
- `docs/DEMO.md` documents the exact path to a runnable visual demo.
