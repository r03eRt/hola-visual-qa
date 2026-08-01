# Feature SPEC — placement-container-checks (#35)

Ticket: #35 · Branch: `feature/placement-container-checks` · Roadmap: Advertising (item 16)
Canonical: `docs/ads/PLACEMENT_MODEL.md`, `docs/specs/SPEC-006-AD-PLACEMENTS.md`

## Goal
The FIRST consumer of the placement contract (#33): verify a placement's
**container stage** — does the expected container exist, is it visible when it
should be, and do its rendered dimensions match one of the declared
`allowedSizes`? Split into a thin **dependency-injected reader** (gathers raw
`present`/`visible`/`boundingBox` from a Playwright-like page) and a **pure
evaluator** (maps raw observations + per-device visibility expectation +
`allowedSizes` into a `ContainerObservation`, including the `containerFound`
signal that `classifyPlacement` consumes). No real browser in unit tests.
Additive; changes no existing module behaviour.

## Context and linked canonical specs
- `docs/ads/PLACEMENT_MODEL.md` — container is one stage of the state machine;
  this feature produces the `containerFound` signal (and does NOT observe
  request/render). "Expected container exists and is visible when applicable"
  and "Dimensions match allowed sizes" are the two container checks here.
- `docs/specs/SPEC-006-AD-PLACEMENTS.md` — must not assert revenue/fill from DOM
  appearance; this only checks container presence/visibility/geometry.
- Reuse `src/placements/model.ts` (`PlacementDefinition`, `PlacementSize`) and
  `src/placements/state-machine.ts` (`classifyPlacement`, `PlacementSignals`)
  from #33 — do NOT redefine them.
- DI patterns to MIRROR: `src/consent/ui-types.ts` (`ConsentLocatorLike` with
  `first()`/`isVisible()`) and `src/stability/page-like.ts` (minimal structural
  page). Error-subclass pattern to MIRROR: `src/visual/target.ts`.
- Device type: `Scenario['device']` (`'desktop' | 'mobile'`) from `src/domain`.
- Error taxonomy (`src/domain/error.ts`): a container-check failure is
  `placement_failure` / phase `assertion`.

## Non-goals
- Request/render event capture (items 17–18) and layout-shift (item 19).
- Overlap-with-protected-content checks (later — `protectedRegions` is defined
  but NOT evaluated here).
- Any assertion about ad fill or revenue.
- Wiring into the scenario planner / orchestrator / visual suite, or exposing
  `PlacementDefinition[]` via `ProjectConfig` (later ticket). This feature is
  standalone and hermetic.
- Waiting/polling/timeouts: the reader takes a single-shot observation; the
  `timeoutMs` in the definition is a later (request/render) concern.

## Proposed interfaces and files
New file `src/placements/container.ts`:
- DI structural interfaces (a real Playwright `Page`/`Locator` satisfy them):
  ```ts
  export interface PlacementBoundingBox { x: number; y: number; width: number; height: number; }
  export interface PlacementLocatorLike {
    count(): Promise<number>;
    first(): PlacementLocatorLike;
    isVisible(): Promise<boolean>;
    boundingBox(): Promise<PlacementBoundingBox | null>;
  }
  export interface PlacementContainerPageLike {
    locator(selector: string): PlacementLocatorLike;
  }
  ```
- Raw + result shapes:
  ```ts
  export interface RawContainerState {
    present: boolean;                 // locator count > 0
    visible: boolean;                 // first().isVisible()
    box: { width: number; height: number } | null;  // rounded from boundingBox(); null when not measurable
  }
  export interface ContainerObservation {
    placementId: string;
    device: Scenario['device'];
    expectedVisible: boolean;         // definition.visibility[device]
    present: boolean;
    visible: boolean;
    size: { width: number; height: number } | null;
    matchedSize: PlacementSize | null;   // the allowedSizes entry matched (within tolerance), else null
    sizeAllowed: boolean;
    containerFound: boolean;          // the classifyPlacement container-stage signal
    applicableOnDevice: boolean;      // = expectedVisible; feeds classifyPlacement.applicable
    satisfied: boolean;               // full container-stage verdict (see rules)
    reason?: string;                  // report-safe reason when !satisfied (no secrets/values beyond sizes)
  }
  export interface ContainerCheckOptions { tolerancePx?: number; } // default 1
  ```
- Reader (DI, the only impure boundary — still no browser in tests):
  ```ts
  export async function readContainerState(
    page: PlacementContainerPageLike, definition: PlacementDefinition
  ): Promise<RawContainerState>;
  ```
  Behaviour: `const loc = page.locator(definition.containerSelector);`
  `present = (await loc.count()) > 0`. If not present → `{ present:false,
  visible:false, box:null }` (do not call further). Else
  `visible = await loc.first().isVisible()`; `const bb = await
  loc.first().boundingBox();` `box = bb ? { width: Math.round(bb.width),
  height: Math.round(bb.height) } : null`.
- Pure evaluator (no fs/Date/random/env/DOM):
  ```ts
  export function evaluateContainer(
    definition: PlacementDefinition, device: Scenario['device'],
    raw: RawContainerState, options?: ContainerCheckOptions
  ): ContainerObservation;
  ```
- Assertion + error:
  ```ts
  export class PlacementContainerError extends Error { readonly normalized: NormalizedError; }
  export function assertContainer(observation: ContainerObservation): void; // throws when !satisfied
  ```
- Update `src/placements/index.ts` barrel to `export * from './container.js'`.

## Behaviour — evaluateContainer rules
Let `expectedVisible = definition.visibility[device]` and `tol = options?.tolerancePx ?? 1`.
- `sizeAllowed`/`matchedSize`: `raw.box` matches an `allowedSizes` entry when
  `|box.width - size.width| <= tol && |box.height - size.height| <= tol`.
  `matchedSize` = the FIRST matching entry (input order) or `null`; `sizeAllowed
  = matchedSize !== null`. When `raw.box === null`, `sizeAllowed = false`,
  `matchedSize = null`.
- `containerFound = raw.present && raw.visible` (the state-machine gate — a
  present-but-hidden container is NOT "found/ready").
- `applicableOnDevice = expectedVisible`.
- **satisfied**:
  - When `expectedVisible === true`: `satisfied = containerFound && sizeAllowed`.
    `reason` (when false) names the first failing check in order:
    `'container missing'` (`!present`), else `'container not visible'`
    (`present && !visible`), else `'size not allowed'` (`!sizeAllowed`, include
    the observed `WxH` and it is a size — not a secret).
  - When `expectedVisible === false` (placement must NOT show on this device):
    `satisfied = !raw.visible` (absent or hidden is correct); `reason` (when
    false) = `'unexpectedly visible on <device>'`. `sizeAllowed` is still
    computed for diagnosis but does NOT affect `satisfied`.
- Always set `placementId = definition.id`, echo `device`, `present`, `visible`,
  `size = raw.box`.

`assertContainer(observation)`: if `observation.satisfied` return; else throw a
`PlacementContainerError` (normalized `placement_failure`/`assertion`) whose
message is `` `Placement "<id>" container check failed: <reason>` `` — report-safe
(id, the reason string, and sizes only; never a selector value beyond the id or
any page content).

Helper for the state machine: consumers derive the signal via
`classifyPlacement(definition.id, { applicable: observation.applicableOnDevice,
containerFound: observation.containerFound })`. (No new wrapper is required, but
if convenient add a tiny `toContainerSignals(observation): Pick<PlacementSignals,
'applicable' | 'containerFound'>` — keep it pure and covered by a test.)

## Acceptance criteria
- [ ] `readContainerState`: not-present short-circuits to `{present:false,
      visible:false,box:null}` without calling `isVisible`/`boundingBox`; present
      path rounds the bounding box to integer `{width,height}`; a `null`
      boundingBox yields `box:null`. Verified with a fake locator/page (no browser).
- [ ] `evaluateContainer` (expectedVisible true): satisfied only when present +
      visible + a size within tolerance matches; `matchedSize` is the first
      in-order match; a `box` off by `<= tol` matches, `> tol` does not; each
      failing case sets the correct ordered `reason`.
- [ ] `evaluateContainer` (expectedVisible false): satisfied iff not visible; a
      visible container yields `satisfied:false` with the `'unexpectedly visible'`
      reason; `sizeAllowed` is computed but does not change `satisfied`.
- [ ] `containerFound === present && visible` and `applicableOnDevice ===
      definition.visibility[device]` in all cases; feeding these into
      `classifyPlacement` yields the expected `PlacementState`
      (present+visible→`container_ready`; missing→`container_missing`;
      not-expected→`skipped`).
- [ ] `assertContainer` throws a normalized `placement_failure`/`assertion`
      `PlacementContainerError` with a report-safe message on failure, and does
      not throw when satisfied.
- [ ] No selector value or page content beyond the placement id and numeric
      sizes appears in any observation field or error message.

## Test plan
`tests/unit/placement-container-checks.spec.ts` (hermetic, no browser):
- Fake `PlacementLocatorLike`/`PlacementContainerPageLike` scripted with
  count/visible/boundingBox; assert `readContainerState` short-circuit and the
  present/rounding/null-box paths, and that `isVisible`/`boundingBox` are NOT
  called when count is 0 (spy/counter on the fake).
- `evaluateContainer` truth tables for both `expectedVisible` values, tolerance
  boundary (exact, `tol`, `tol+1`), first-match selection with multiple
  `allowedSizes`, and each ordered `reason`.
- Integration-in-unit: build signals from an observation and pass to the real
  `classifyPlacement`, asserting the resulting state for the three key cases.
- `assertContainer` throw/no-throw + normalized category/phase + a value-leak
  assertion (a distinctive selector string is NOT present in the message).

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`. No browser; do NOT
  run the visual suite.

## Security/privacy impact
Only the placement id, a device string, booleans and numeric sizes cross into
observations/errors — never the raw selector value or any page content. Nothing
is written to disk.

## Baseline impact
None. No screenshots taken or compared.

## Dependencies and risks
- Depends on `src/placements/*` (#33) and `src/domain` types only.
- Risk: real bounding-box fractional values — mitigated by rounding + integer
  tolerance. Real-page behaviour is validated later when the checker is wired
  into scenario execution (out of scope here).

## Handover notes
Additive module `src/placements/container.ts`. Items 17–19 (request/render
events, layout shift) and orchestrator/config wiring are separate later tickets.
