# Feature: playwright-placement-event-bridge

## Goal

Wire the request/render placement stages (items 18/19) into real runs by adding
the missing Playwright **event bridge** that backs `PlacementEventSourceLike`,
then evaluating request/render per placement and asserting the classified
terminal verdict. Deterministic; an LLM never decides pass/fail.

## Context and linked canonical specs

- `docs/ads/PLACEMENT_MODEL.md` — the state machine; request/render are debug events.
- `docs/features/placement-request-events/SPEC.md` (#37), `docs/features/placement-render-events/SPEC.md` (#39) — the pure evaluators + generic `PlacementEventsCollector` this bridge feeds, reused unchanged.
- `docs/features/live-placement-container-checks/SPEC.md` (#83) — the container-stage wiring this extends.
- `AGENTS.md` — "Playwright and explicit rules decide pass/fail; an LLM never does."

## Design

Request/render outcomes (`rendered`/`empty`/`provider_error`/`timeout`) are
semantic and cannot be inferred from raw network traffic — they are page-emitted
debug events, consistent with this project's debug-signal adapters
(consent/ads/country). The bridge is a generic receiver, not a network sniffer,
so no URL/header/body/vendor payload is ever captured.

## Non-goals

- Network-request URL matching / raw payload capture (deliberately avoided).
- Layout-shift wiring (#41); embedding `PlacementObservation`s into `result.json` (later slice).
- Fabricating `timeout` when nothing is observed (non-terminal stays a pass).
- Providing a site instrumentation shim (the target emits its own debug events).

## Proposed interfaces and files

- `src/placements/bridge.ts` (new): `installPlacementEventBridge(page, options?)` over a DI `PlacementBindingPageLike { exposeFunction(name, cb): Promise<unknown> }` (a real Playwright `Page` satisfies it). Exposes `bindingName` (default `__qaPlacementEvent`); each page-side call is normalized by the pure exported `normalizePlacementPayload(payload)` to EXACTLY `{ placementId, signal }` (non-empty strings) or dropped — the privacy guard. Returns a `PlacementEventSourceLike` whose `on('placement', ...)` handlers receive normalized events; `on` must be registered before navigation (documented).
- `src/placements/resolve.ts` (new): pure `assertPlacementResolved(definition, observation)` throwing a normalized `placement_failure`/`assertion` `PlacementResolutionError` when `observation.terminal && !isPlacementSatisfied(...)`; silent on a satisfied or non-terminal state. Message names only the placement id + state/stage.
- `tests/visual/scenarios.spec.ts`: when a work item has placements with `events.request`/`events.render`, install the bridge + collector before `goto`; after the container assert, evaluate request+render, `classifyPlacement`, and `assertPlacementResolved`. No-op otherwise; unchanged default run.

## Acceptance criteria

- [x] `normalizePlacementPayload` accepts only `{placementId, signal}` non-empty strings and drops extras/malformed (never forwards arbitrary data).
- [x] `installPlacementEventBridge` exposes exactly one binding and dispatches normalized events to registered handlers (DI fake).
- [x] `assertPlacementResolved` fails a terminal-unsatisfied placement (`request_missing`, `empty` without `expectedEmpty`, `provider_error`, `timeout`) and passes `rendered`/`skipped`/expected-`empty`/non-terminal, with a report-safe message.
- [x] The visual suite runs request/render checks for event-configured placements and is a no-op otherwise; the committed default run stays green.
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit` pass with new hermetic tests.

## Test plan

- Hermetic units: `tests/unit/placement-event-bridge.spec.ts` (normalizer accept/drop/reject matrix, single-binding registration, custom name, dispatch-and-drop, end-to-end into the real collector with a privacy assertion) and `tests/unit/placement-resolve.spec.ts` (satisfied/skipped/non-terminal no-throw; `request_missing`/`provider_error`/`timeout`/`empty` throw; `expectedEmpty` exception; normalized category/phase + value-free message).
- Real browser (local cached Chromium, example.com, throwaway integration spec, reverted/not committed): a page `addInitScript` emitted `{placementId, signal}` debug events (plus a URL/token payload and a garbage call); the bridge fed the real collector, `evaluateRequest`/`evaluateRender` + `classifyPlacement` produced `rendered` (assert passes) and `provider_error` (assert throws `PlacementResolutionError`), and the dropped URL/token never entered the snapshot. The committed default run (no event placements) stays GREEN.

## Security/privacy impact

Low/positive: the bridge is the exact point where untrusted page data enters, so it hard-normalizes to two strings and drops everything else — no URL/body/header/payload capture. No new secrets/network/artifacts. `type:feature`.

## Baseline impact

None. No screenshots/baselines; request/render are event-driven assertions.

## Dependencies and risks

- Depends on #37/#39 (merged, pure) and #83 (merged). No runtime dependency changes.
- Risk: a target that emits no placement debug events leaves request/render non-terminal (a pass) — intentional (the model forbids fabricated outcomes); documented in DEMO.

## Handover notes

The QA target (or an injected adapter) must call `window.__qaPlacementEvent({ placementId, signal })` with the configured `events.request` and `events.render:<outcome>` signals. Next slices: layout-shift wiring (#41) and embedding `PlacementObservation`s into the report.
