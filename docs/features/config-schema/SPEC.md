# Feature: config-schema

Roadmap item #2 (Foundation). Tracking issue: #3.

## Goal

A committed, **versioned, non-secret** project configuration validated with Zod,
kept strictly separate from secrets. Gives later features (scenario planner,
adapters, visual/diagnostics/artifacts/ai policies) a single validated contract
to build on.

## Context and linked canonical specs

- `docs/architecture/CONFIGURATION_MODEL.md` — canonical schema and requirements.
- `docs/architecture/ERROR_MODEL.md` — aggregate/report errors consistently.
- ADR-001 (local-first): config is a committed file, no hosted backend.
- Existing `src/config/env.ts` — Zod-validated **secrets/machine** values; this
  feature must NOT fold secrets into the project config.

## Non-goals

- No scenario expansion / planner (item #4) — only define the dimensions schema.
- No adapter behaviour, browser, visual diffing, diagnostics or AI execution.
- No domain result/run types (item #3 in plan).
- No CLI flag parsing (item covered by SPEC-012 later); only `loadConfig()`.

## Proposed interfaces and files

- `src/config/schema.ts` — Zod schemas + inferred TypeScript types:
  - `ProjectConfig` with a required `schemaVersion` (literal, e.g. `1`).
  - Top-level shape per CONFIGURATION_MODEL: `projectName`, `baseUrl`,
    `allowedHosts`, `pages`, `dimensions`, `adapters`, `visual`, `diagnostics`,
    `artifacts`, `ai`, `execution`.
  - Every object uses `.strict()` so **unknown properties fail validation**.
  - Sub-policies may be lean but forward-compatible (sensible defaults via
    `.default()`); leave room for later features to extend. No secret fields
    (no API keys/tokens) anywhere in the schema.
  - `dimensions` covers device/consent/country/ads as string/enum arrays; do NOT
    expand to scenarios here.
- `src/config/load-config.ts`:
  - `loadConfig(input?: unknown): ProjectConfig` — validates a provided object
    (used in tests) or, when omitted, loads the committed config module.
  - Aggregates ALL validation issues into one thrown error (use Zod's issue
    list / `z.treeifyError` style), not fail-fast on the first.
  - Applies env overrides ONLY for an explicit allowlist (e.g. `BASE_URL` →
    `baseUrl`, `TEST_COUNTRY` into dimensions). Overrides are validated too.
  - Never reads secret env vars into the returned config.
- `visual-qa.config.ts` — committed, non-secret example/default config that
  passes validation (baseUrl `https://example.com`, one page `/`, ES/desktop+
  mobile/accepted+rejected/ads on-off dimensions).
- Do NOT modify `env.ts` beyond what is needed to keep secrets separate.

## Acceptance criteria

- [x] `ProjectConfig` Zod schema exists with `schemaVersion` and strict objects;
      unknown keys cause a validation failure.
- [x] `loadConfig()` returns a typed, validated `ProjectConfig` for the committed
      `visual-qa.config.ts`.
- [x] Invalid config throws an error that lists **all** problems together, not
      just the first.
- [x] Env overrides apply only to allowlisted fields; a non-allowlisted env var
      cannot change config; no secret ever appears in the returned object.
- [x] Unit tests cover: valid config, unknown-key rejection, multi-error
      aggregation, allowlisted override applied, non-allowlisted override ignored,
      secret-not-leaked.
- [x] `npm run typecheck` and `npm run lint` exit 0. `docs/STATUS.md` "Scenario
      matrix"/config note updated honestly (config contract now exists;
      expansion still pending).

## Test plan

- Add `tests/unit/config.spec.ts` run via Playwright's test runner (no browser)
  or a lightweight node test — match the repo's existing runner (Playwright
  `test` supports non-page unit tests). Assert the acceptance bullets above.
- `npm run typecheck` → 0, `npm run lint` → 0.
- Do NOT run the visual suite (needs baselines/BASE_URL — out of scope).

## Security/privacy impact

Positive: enforces that secrets stay in `.env`/`env.ts` and never enter the
committed config or any serialized output. `allowedHosts` in the schema lays
groundwork for later host-allowlisting (navigation safety). No network use.

## Baseline impact

None. No screenshots or expected UI change.

## Dependencies and risks

- Depends on locked-toolchain (#1, merged) for Zod pin and working lint.
- Risk: over-modelling sub-policies now and colliding with later features.
  Mitigation: keep sub-schemas minimal + defaulted; only the top-level contract
  and validation semantics are required here.
- Risk: choosing a unit-test runner. Mitigation: reuse Playwright's `test`
  runner for a pure-function unit spec to avoid adding tooling.

## Handover notes

Pure, well-scoped execution after this spec — suitable for Sonnet 5. Escalate to
Opus only if a sub-policy's shape forces a cross-feature design decision.
Implementer: follow `skills/superpowers/test-driven-development` (write the
config unit tests first) and `verification-before-completion` before the PR
(`Closes #3`).
