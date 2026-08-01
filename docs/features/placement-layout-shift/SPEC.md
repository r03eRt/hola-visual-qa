# Feature specification — Placement layout shift (item 19)

Ticket: #41 · Branch: `feature/placement-layout-shift` · Roadmap: item 19
(last item of the Advertising block).

## Summary

An **additive, hermetic** evaluator that measures the **layout shift
attributable to an ad placement** and classifies it against a configurable
tolerance. It compares a **before** snapshot (the ad slot reserved/empty) with
an **after** snapshot (the ad rendered), computing how far the placement
container and each configured `protectedRegion` moved, then reports a
`LayoutShiftObservation`.

This implements the SPEC-006 line "Layout shift attributable to the placement
is measured where feasible." It is **independent of the `classifyPlacement`
state machine** — layout shift is a quality signal, not a stage transition — so
it does **not** feed `PlacementSignals` and does **not** modify
`state-machine.ts`, `model.ts`, `events.ts`, `container.ts`, `request.ts` or
`render.ts`.

## Non-goals (explicitly out of scope)

- No real browser, DOM, `PerformanceObserver`/CLS layout-shift entries, `fs`,
  `Date`, `Math.random`, or `process.env` in source or tests.
- Not wired into the planner/orchestrator/config. No scenario assembly here.
- No revenue/fill claims and no DOM-appearance inference — geometry only.
- No screenshot capture, diffing or baseline work (that is the visual suite).
- Does not change the placement state machine or its terminal states.
- No thresholds sourced from network/env — the tolerance is a plain option.

## Design

Mirror the reader-DI + pure-evaluator split already used by
`src/placements/container.ts`:

1. A dependency-injected **reader** collects raw bounding boxes for the
   placement container and its protected regions at a single point in time. A
   real Playwright `Page`/`Locator` satisfies the structural interface, but no
   browser is used or imported here or in tests.
2. Two raw snapshots (**before** and **after**) are captured by the caller
   (e.g. before vs after the ad renders). This module does not orchestrate
   *when* they are taken.
3. A pure **evaluator** computes per-region displacement between the two
   snapshots and classifies the overall shift.

Reuse the existing `PlacementBoundingBox` structural type and the
`PlacementLocatorLike` / `PlacementContainerPageLike` DI shapes from
`container.ts` by **importing** them (do not redefine). Reuse
`definition.protectedRegions` and `definition.containerSelector` from
`model.ts`.

## Displacement metric

For a single element identified by a selector, displacement between the before
box `b` and after box `a` is the **Euclidean distance of the top-left corner**:

```
displacement(b, a) = round( sqrt( (a.x - b.x)^2 + (a.y - b.y)^2 ) )
```

Rounded to the nearest integer pixel (`Math.round`), consistent with
`container.ts` size rounding. If either box is `null` (element absent in that
snapshot) the element's displacement is **not measurable** and is recorded as
`null` (it must NOT be treated as zero and must NOT be treated as an
exceedance).

Rationale: top-left corner motion is the deterministic, attributable proxy for
"the ad pushed neighboring content". Size changes are already covered by the
container stage (#16); this feature is about *movement*.

## Classification

`LayoutShiftLevel = 'none' | 'within_tolerance' | 'exceeded'`.

Given `tolerancePx` (default `2`, integer ≥ 0) and the set of measurable
per-region displacements:

- `none` — every measurable displacement is exactly `0`.
- `within_tolerance` — the maximum measurable displacement is `> 0` and
  `<= tolerancePx`.
- `exceeded` — the maximum measurable displacement is `> tolerancePx`.
- When there are **no measurable displacements at all** (no regions, or every
  region unmeasurable in at least one snapshot), the level is `none` and
  `measurable` is `false` — the evaluator never fabricates an exceedance from
  missing data.

`satisfied = level !== 'exceeded'`.

## Proposed interfaces and files

### CREATE `src/placements/layout-shift.ts`

```ts
import type { PlacementDefinition } from './model.js';
import {
  type PlacementBoundingBox,
  type PlacementContainerPageLike
} from './container.js';
import { normalizeError, type NormalizedError } from '../domain/error.js';

export type LayoutShiftLevel = 'none' | 'within_tolerance' | 'exceeded';

/** One selector's before/after boxes and derived top-left displacement. */
export interface RegionDisplacement {
  /** 'container' for the placement container, otherwise a protected-region
   *  index label like 'protected[0]'. The raw selector value is NEVER stored. */
  label: string;
  before: PlacementBoundingBox | null;
  after: PlacementBoundingBox | null;
  /** rounded Euclidean top-left displacement, or null when not measurable. */
  displacementPx: number | null;
}

/** Raw single-snapshot geometry gathered by readLayoutSnapshot. */
export interface RawLayoutSnapshot {
  container: PlacementBoundingBox | null;
  protectedRegions: (PlacementBoundingBox | null)[];
}

export interface LayoutShiftObservation {
  placementId: string;
  regions: RegionDisplacement[];
  /** max measurable displacement across regions, or null when none measurable. */
  maxDisplacementPx: number | null;
  measurable: boolean;
  tolerancePx: number;
  level: LayoutShiftLevel;
  satisfied: boolean;
  reason?: string;
}

export interface LayoutShiftOptions {
  tolerancePx?: number; // default 2, integer >= 0
}

/** DI reader: one snapshot of container + protectedRegions boxes. Reuses the
 *  container.ts locator shapes; short-circuits missing elements to null. */
export async function readLayoutSnapshot(
  page: PlacementContainerPageLike,
  definition: PlacementDefinition
): Promise<RawLayoutSnapshot>;

/** Pure evaluator over two snapshots. */
export function evaluateLayoutShift(
  definition: PlacementDefinition,
  before: RawLayoutSnapshot,
  after: RawLayoutSnapshot,
  options?: LayoutShiftOptions
): LayoutShiftObservation;

/** Normalized placement_failure/assertion error, mirroring PlacementContainerError. */
export class PlacementLayoutShiftError extends Error {
  readonly normalized: NormalizedError;
  constructor(message: string, options?: { evidenceRefs?: string[] });
}

/** Throws PlacementLayoutShiftError when level === 'exceeded'; the message
 *  names only the placementId, the max displacement and the tolerance. */
export function assertLayoutShift(observation: LayoutShiftObservation): void;
```

### `readLayoutSnapshot` rules

- `container = boundingBox(page.locator(definition.containerSelector).first())`
  when `count() > 0`, else `null` (short-circuit; do not call `boundingBox` on
  a zero-match locator).
- For each selector in `definition.protectedRegions` (in order): same
  present-then-measure logic; push the box or `null`.
- Boxes are stored as `{x, y, width, height}` with `x`/`y` preserved and
  rounded to integers via `Math.round` on read (so the pure evaluator gets
  clean integers). Width/height are carried through (rounded) but the metric
  only uses `x`/`y`.
- No waiting/polling/timeouts. No visibility check (movement of a hidden-but-
  present element still matters; presence gates measurability).

### `evaluateLayoutShift` rules (verbatim)

1. Build the region list in this fixed order: first the `'container'` region
   (before.container vs after.container), then one region per protected-region
   index `i` labeled `` `protected[${i}]` `` (before.protectedRegions[i] vs
   after.protectedRegions[i]).
2. For each region: `displacementPx = (before && after) ? round(euclidean
   top-left distance) : null`.
3. `measurableDisplacements = regions.map(r => r.displacementPx).filter(d => d
   !== null)`.
4. `maxDisplacementPx = measurableDisplacements.length ?
   Math.max(...measurableDisplacements) : null`.
5. `measurable = maxDisplacementPx !== null`.
6. `tolerancePx = Math.max(0, Math.trunc(options?.tolerancePx ?? 2))`.
7. `level`: if `!measurable || maxDisplacementPx === 0` → `'none'`; else if
   `maxDisplacementPx <= tolerancePx` → `'within_tolerance'`; else
   `'exceeded'`.
8. `satisfied = level !== 'exceeded'`.
9. `reason` is set ONLY when `level === 'exceeded'`:
   `` `layout shift ${maxDisplacementPx}px exceeds tolerance ${tolerancePx}px` ``.
10. The observation stores only ids/labels/numbers/booxes — never a raw
    selector string or page content.

### `assertLayoutShift`

- Returns silently when `satisfied`.
- Otherwise throws `PlacementLayoutShiftError` with message
  `` `Placement "${id}" layout shift check failed: ${reason}` `` and a
  normalized `{category: 'placement_failure', phase: 'assertion'}` error
  (mirror `PlacementContainerError`).

### EDIT `src/placements/index.ts`

Add `export * from './layout-shift.js';` (keep existing exports).

### EDIT `docs/STATUS.md`

Add ONE honest `partial` row "Placement layout shift"; leave all existing rows
(incl. "Ad placement checks" and "Placement render events") unchanged.

## Acceptance criteria

- [ ] `readLayoutSnapshot` returns `null` for absent container/regions without
      calling `boundingBox` on a zero-match locator; returns rounded-integer
      boxes otherwise; visits protected regions in definition order.
- [ ] `evaluateLayoutShift` computes rounded Euclidean top-left displacement
      per region; unmeasurable region → `displacementPx: null` (not 0, not an
      exceedance).
- [ ] `level` follows the verbatim rules; `none` when nothing measurable or all
      zero; `within_tolerance` at the boundary (`== tolerancePx`); `exceeded`
      strictly above.
- [ ] `tolerancePx` defaults to 2, is clamped to an integer ≥ 0, and the
      boundary is inclusive (`<= tolerancePx` is within tolerance).
- [ ] `satisfied === (level !== 'exceeded')`; `reason` present only when
      exceeded and free of selector/page content.
- [ ] `assertLayoutShift` throws a normalized `placement_failure`/`assertion`
      error only on exceedance; silent otherwise.
- [ ] Region labels are `'container'` / `` `protected[${i}]` `` only; no raw
      selector value appears anywhere in the observation JSON.
- [ ] Barrel exports the module; STATUS.md gets one honest `partial` row.
- [ ] `npm run typecheck`, `npm run lint`, `npm run test:unit` all exit 0.

## Test plan (`tests/unit/placement-layout-shift.spec.ts`, hermetic)

Use a fake `PlacementContainerPageLike` whose `locator(selector)` returns a
scripted `PlacementLocatorLike` (count/first/isVisible/boundingBox) driven by a
per-selector map — mirror how `tests/unit/placement-container-checks.spec.ts`
fakes the page. No real browser.

- `readLayoutSnapshot`: absent container → `null` and `boundingBox` NOT called;
  present container + two protected regions (one absent) → correct
  `[box, null]` order and rounded integers.
- `evaluateLayoutShift`:
  - no movement (identical before/after) → `level: 'none'`, `maxDisplacementPx:
    0`, `measurable: true`, `satisfied: true`.
  - pure vertical push of a protected region by 10px, `tolerancePx: 2` →
    `exceeded`, `maxDisplacementPx: 10`, `reason` set, `satisfied: false`.
  - diagonal move (3,4) → displacement `5` (Pythagorean), classified vs
    tolerance.
  - boundary: max displacement `== tolerancePx` → `within_tolerance`,
    `satisfied: true`; `tolerancePx + 1` → `exceeded`.
  - container moved but regions still → max across all regions is used.
  - unmeasurable: region absent in `after` → that region `displacementPx: null`
    and excluded from the max; if ALL regions unmeasurable → `measurable:
    false`, `level: 'none'`, `satisfied: true` (no fabricated exceedance).
  - empty `protectedRegions` and null container in both snapshots →
    `measurable: false`, `level: 'none'`.
  - `tolerancePx` default (omitted) is 2; negative/fractional option is clamped
    (`-5 → 0`, `2.9 → 2`).
- `assertLayoutShift`: throws `PlacementLayoutShiftError` with normalized
  `category: 'placement_failure'`, `phase: 'assertion'` on exceedance; does not
  throw when within tolerance/none.
- Privacy: build a definition with a secret-looking selector value and assert
  `JSON.stringify(observation)` contains neither the selector string nor any
  page content — only labels/ids/numbers.

## Verification

`npm run typecheck` (0) · `npm run lint` (0) · `npm run test:unit` (0, count
increases). No visual/real-browser suite.
