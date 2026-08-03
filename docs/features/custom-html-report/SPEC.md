# Feature: custom-html-report

## Goal

Generate a **self-contained, local, static HTML report** from a `RunResult`
(SPEC-009). The report groups failures by page and probable category, displays
scenario dimensions, renders the expected/actual/diff **visual triplet** via
relative artifact links, and makes optional **AI content visually distinct**
from deterministic facts. It **must work when AI is disabled or unavailable**.

## Context and linked canonical specs

- `docs/specs/SPEC-009-REPORTING.md` — the report groups failures by page and
  probable category, shows dimensions, shows visual triplets, and makes AI
  content visually distinct; must work with AI disabled.
- `src/domain/result.ts` — `RunResult`, `ScenarioResult`, `ArtifactRefs`,
  `RunManifest` (the report's inputs). All are secret-guarded (`.strict()` +
  `rejectSecretLikeKeys`).
- `src/reporting/aggregate.ts` — reuse `groupFailuresByPage()` /
  `PageFailureGroup` / `FailureItem` (already implemented).
- `src/ai/analysis.ts` — `AiAnalysis` (optional per-scenario AI content).

## Non-goals

- No richer failure-categorization algorithm (that is #29 `failure-grouping`).
- No `manifest.json` / `summary.json` writers (already covered) and no
  orchestrator wiring.
- No dashboard/server (that is #30-32).
- No client-side JavaScript; the report is readable as static HTML.

## Proposed interfaces and files

- `src/reporting/html/escape.ts` (PURE) — `escapeHtml(value: string): string`
  escaping `& < > " '` (and nothing else); `escapeAttribute` if needed for
  `href`/`src`. This is the single, audited escaping primitive.
- `src/reporting/html/report-model.ts` (PURE) —
  `buildReportModel(run: RunResult, options?: { analyses?: ReadonlyMap<string,
  AiAnalysis> }): ReportModel`. `ReportModel` is a plain, render-ready view
  model: run header (runId, counts, deterministic pass/fail, tool/os/browser
  from `manifest`, timestamps), the `PageFailureGroup[]` from
  `groupFailuresByPage`, and a per-scenario `ScenarioReportRow[]` (dimensions,
  status, category+message, `artifacts` triplet refs, and the matching
  `AiAnalysis` when present). No fs/Date/random; deterministic ordering; never
  mutates inputs.
- `src/reporting/html/render.ts` (PURE) — `renderHtmlReport(model:
  ReportModel): string`. Emits ONE self-contained `<!doctype html>` document
  with inline `<style>` (no external/CDN links, no `<script>`). EVERY
  interpolated value passes through `escapeHtml`/`escapeAttribute`. The visual
  triplet renders `<img src="<relative-ref>">` only when the ref is present
  (expected/actual/diff), else a "no image" note. AI blocks are wrapped in a
  visually distinct container with an explicit label such as "AI analysis —
  informational only, not a pass/fail decision"; when no analysis exists the
  block is omitted. Passing runs render a clean summary with no failure groups.
- `src/reporting/html/write-report.ts` — `writeHtmlReport(model: ReportModel,
  outPath: string, deps?: { writeFile? }): Promise<void>` — the ONLY impure
  layer, a thin `node:fs/promises` writer (DI-injectable for tests) that writes
  the rendered string to `outPath`. No other fs behaviour.
- `src/reporting/html/index.ts` — barrel.
- `src/reporting/index.ts` — extend to re-export the html module.

## Acceptance criteria

- [x] `buildReportModel` is pure, reuses `groupFailuresByPage`, attaches the
      per-scenario `AiAnalysis` only when supplied, and preserves deterministic
      ordering.
- [x] `renderHtmlReport` returns a single self-contained HTML document: inline
      CSS only, NO external/CDN link, NO `<script>`; valid `<!doctype html>`.
- [x] Every interpolated value is HTML-escaped; a crafted `<script>`/`"` in a
      console/network/error/AI string appears as inert text (proven by test).
- [x] The visual triplet renders expected/actual/diff `<img>` from the relative
      artifact refs when present, and degrades gracefully when absent.
- [x] AI content is rendered in a visually distinct, clearly-labelled block and
      is fully OMITTED when no analysis is supplied — the report renders
      correctly with AI disabled.
- [x] `writeHtmlReport` writes via an injectable fs port; the pure renderer does
      no I/O and unit tests do no real fs/network.
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit` green.

## Test plan

- `tests/unit/html-escape.spec.ts` — the five entities escaped, idempotence on
  already-safe text, non-string safety if applicable.
- `tests/unit/html-report-model.spec.ts` — model shape for passing and failing
  runs; grouping reuse; AI attached only when supplied; deterministic order.
- `tests/unit/html-report-render.spec.ts` — self-contained doc (no
  `http`/`src=//`/`<script`), doctype present, triplet present/absent, AI block
  present/absent + the disclaimer label, and an INJECTION test asserting a
  `<script>alert(1)</script>` in an error/console/AI field is escaped (the
  literal `<script>` substring does NOT appear unescaped).
- `tests/unit/html-write-report.spec.ts` — writer calls the injected
  `writeFile` with the rendered string at `outPath`; no real fs.
- Hermetic: no browser, no network, no real fs. Use placeholder strings only
  (no secret-shaped literals).

## Security/privacy impact

Report inputs are already redacted and secret-key-guarded, but this feature
renders free-text (console, network URLs, error and AI messages) into HTML, so
the audited `escapeHtml`/`escapeAttribute` primitive MUST wrap every
interpolation to prevent HTML/script injection. No artifact bytes are inlined
(only relative `src`/`href`), no external resource is loaded, and no secret is
emitted. Requires a `security-review` pass (issue #59 carries `type:security`).

## Baseline impact

None.

## Dependencies and risks

- Builds on the existing `src/reporting` aggregate and `src/domain` result
  contracts; consumes optional `AiAnalysis` from #26/#27.
- Risk: incomplete escaping → XSS when the report is opened locally; mitigated
  by a single escaping primitive applied at every interpolation + an injection
  test + security review.

## Handover notes

Execute with Sonnet against this spec. Keep the renderer PURE and route ALL
interpolation through the escaping primitive. After implementation: independent
review + a `security-review` subagent pass focused on injection/escaping and
secret leakage, then update `docs/STATUS.md` (new "Custom HTML report" row) and
check this spec's acceptance boxes.
