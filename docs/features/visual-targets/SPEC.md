# Feature SPEC — visual-targets (#10)

Ticket: #21 · Branch: `feature/visual-targets` · Roadmap: Browser MVP · Canonical: `docs/specs/SPEC-004-VISUAL-ENGINE.md`

## Goal
Provide a **pure, deterministic** layer that (1) models the four visual target
kinds and (2) resolves each into a normalized *screenshot-assertion plan* plus
the *metadata* that must appear in scenario results. NO browser is launched and
NO screenshot is taken here — this feature produces the inputs a later
snapshot-runner (#11+) will hand to Playwright's `toHaveScreenshot`. Additive
alongside the untouched legacy `tests/visual/` scaffold.

## Non-goals
- Taking/comparing screenshots or writing PNGs (runner wiring is later).
- Baseline update/approval command (that is #11 `baseline-update-command`).
- Config-schema changes: targets are provided in code, thresholds come from the
  existing `VisualPolicy`. Do NOT edit `src/config` or `src/domain`.

## New files (only these under `src/visual/` + one unit test)
- `src/visual/target.ts`
- `src/visual/plan.ts`
- `src/visual/index.ts` (barrel — `export *`)
- `tests/unit/visual-targets.spec.ts`
- update `docs/STATUS.md` (visual-engine row, honest)

## Domain model — `target.ts`
Discriminated union on `kind`:
```ts
export type VisualTarget =
  | { kind: 'full-page' }
  | { kind: 'viewport' }
  | { kind: 'component'; name: string; selector: string }
  | { kind: 'ad-placement'; name: string; selector: string };
```
- `targetId(target): string` — stable, filesystem-safe slug used to name the
  baseline/artifacts. `full-page`→`full-page`, `viewport`→`viewport`,
  `component`→`component-<slug(name)>`, `ad-placement`→`ad-<slug(name)>`.
  Slug = lowercase, `[a-z0-9]+` runs joined by `-`, trimmed; throw a
  configuration_error (via a small `VisualTargetError` carrying `.normalized`,
  category `configuration_error`, phase `planning`) if `name`/`selector` is
  empty or slug is empty. Named kinds MUST provide a non-empty `selector`.

## Baseline identity — `plan.ts`
`BaselineKey` partitions baselines so cross-platform/device images never
compare (SPEC-004 "partitioned by browser/platform policy"):
```ts
export interface BaselinePartition { browser: string; platform: string; device: 'desktop' | 'mobile'; }
export function baselineName(target: VisualTarget, p: BaselinePartition): string;
// -> `<targetId>__<browser>-<platform>-<device>` all slugged, deterministic.
```

## Threshold override (narrow + justified)
```ts
export interface ThresholdOverride { maxDiffPixelRatio: number; justification: string; }
```
- Base threshold = `VisualPolicy.maxDiffPixelRatio`.
- An override MAY narrow behavior but REQUIRES a non-empty `justification`
  (throw `VisualTargetError` configuration_error if missing/blank) and
  `maxDiffPixelRatio` in `[0,1]` (throw otherwise). The justification is
  preserved in the metadata for human review.

## Resolution — `plan.ts`
```ts
export interface ScreenshotAssertionPlan {
  targetId: string;
  baselineName: string;
  fullPage: boolean;              // true only for 'full-page'
  clipSelector?: string;          // set for 'component' | 'ad-placement'
  maxDiffPixelRatio: number;      // effective (override wins)
  maskSelectors: string[];        // declared masks, deduped, order-stable
  animations: 'disabled' | 'allow';
}
export interface VisualTargetMetadata {   // -> embedded in result.json later
  targetId: string;
  kind: VisualTarget['kind'];
  baselineName: string;
  maxDiffPixelRatio: number;
  thresholdOverride?: ThresholdOverride;  // present only when applied
  maskSelectors: string[];
}
export interface ResolveTargetInput {
  target: VisualTarget;
  policy: VisualPolicy;              // from src/config
  partition: BaselinePartition;
  maskSelectors?: string[];         // declared masks (e.g. from readiness policy)
  override?: ThresholdOverride;
}
export function resolveTargetPlan(input: ResolveTargetInput):
  { plan: ScreenshotAssertionPlan; metadata: VisualTargetMetadata };
```
Rules:
- `fullPage` true iff `kind==='full-page'`; `clipSelector` set iff named region.
- `viewport` → neither fullPage nor clip (default viewport capture).
- `maxDiffPixelRatio` = override?.maxDiffPixelRatio ?? policy.maxDiffPixelRatio.
- `animations` copied from `policy.animations`.
- `maskSelectors` deduped preserving first-seen order.
- Deterministic: same inputs → deeply equal outputs. Pure functions only,
  no Date/random/env/fs.

## Acceptance criteria (SPEC-004)
- Four kinds resolve to correct `fullPage`/`clipSelector` shapes.
- Threshold + mask metadata are present in `VisualTargetMetadata` (maps to
  "Threshold and mask metadata appear in scenario results").
- A narrow override without justification is rejected; with justification it is
  applied and preserved in metadata (reviewable).
- Baseline names differ across browser/platform/device partitions (no
  accidental cross-platform comparison).
- All error paths throw a normalized `configuration_error`/`planning` error.

## Verification
- `npm run typecheck`, `npm run lint`, `npm run test:unit` all exit 0.
- Hermetic: unit test imports only `src/visual` + `src/config`/`src/domain`
  types; launches NO browser. Do NOT run the visual suite.
