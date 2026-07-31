# Current implementation status

Status labels: `scaffold`, `partial`, `implemented`, `verified`.

| Capability | Status | Notes |
|---|---|---|
| Repository bootstrap | implemented | Dependency versions are exact-pinned to mutually-compatible, lockfile-resolved versions (no `latest`, no ranges, no npm hacks): `typescript@5.9.3` and `@types/node@22.20.1` (downgraded from TS 7/`@types/node` 26 to stay compatible with `typescript-eslint@8.65.0`), `eslint@10.8.0`, `@eslint/js@10.0.1`, `@anthropic-ai/sdk@0.115.0`, `dotenv@17.4.2`, `zod@4.4.3`, `@playwright/test@1.62.1`, `tsx@4.23.1`. `npm ci` succeeds cleanly from the committed lockfile with no `.npmrc`/`legacy-peer-deps` and no package aliases. `eslint.config.js` (flat config, `@eslint/js` + `typescript-eslint` recommended, scoped to `src/`, `tests/`, `scripts/`, `*.config.ts`) is in place and `npm run lint` exits 0 (one real unused-catch-binding violation fixed in `scripts/new-ticket.mjs`). `npm run typecheck` exits 0. TS 7 remains unpinned for now — revisit as a separate chore once `typescript-eslint` ships support (tracked upstream). |
| Project configuration contract | implemented | `src/config/schema.ts` defines a strict, versioned Zod `ProjectConfig` (unknown keys fail on every object); `src/config/load-config.ts#loadConfig()` validates the committed `visual-qa.config.ts` or a supplied object, aggregates all validation issues into one thrown `ConfigValidationError`, and applies only an explicit env allowlist (`BASE_URL`, `TEST_COUNTRY`) — no secret ever enters the returned config. Verified by `tests/unit/config.spec.ts` (22 assertions across both Playwright projects), `npm run typecheck` and `npm run lint` (both exit 0). Scenario expansion (turning `dimensions` into concrete scenarios) is still pending — see next row. |
| Domain result/error contracts | implemented | `src/domain/error.ts` defines the 12 `ErrorCategory` values, the `Phase` union and `normalizeError()`, which produces a stable `code`, ISO `timestamp` and a redacted, stack-free, report-safe `message` (auth headers, cookie values and `sk-`/api-key-like tokens are stripped); `ai_provider_error` defaults to `severity: 'warning'` unless overridden. `src/domain/result.ts` defines provider-neutral `Scenario`, `ArtifactRefs` (relative paths only), `ScenarioResult`, `RunManifest`, `RunResult` and `RunSummary`, all as strict Zod schemas (`z.output` is the single source of truth) that reject unknown keys and any secret-looking field (`apiKey`, `authorization`, `cookie`, `secret`, `password`, `token`, ...) at every object level; `computeDeterministicFailure()` is true iff a non-skipped result is `failed` or carries a non-warning error — AI warnings alone never trigger it. `src/domain/index.ts` barrels both modules. Purely additive; `src/scenarios/scenarios.ts` is untouched. Verified by `tests/unit/domain.spec.ts` (70 assertions across both Playwright projects), `npm run typecheck` and `npm run lint` (both exit 0). No path building, run-id generation, manifest writing or scenario expansion yet — that is later work. |
| Scenario matrix | scaffold | Example types and scenarios exist; filtering and validation are incomplete. `ProjectConfig.dimensions` now defines the device/consent/country/ads arrays as a validated contract, but no planner expands them into scenario IDs yet. |
| Consent engine | scaffold | Example cookie/UI logic only; must be adapted to Hola's CMP. |
| Page stabilization | partial | Basic animation/font handling exists; policy and diagnostics need implementation. |
| Visual baselines | partial | Playwright screenshot assertion example exists. Baseline governance is documented. |
| Diagnostics | scaffold | Event listeners exist; artifact aggregation and report integration are incomplete. |
| Ad placement checks | not implemented | Specification only. |
| Country override | not implemented | Requires an internal QA mechanism or proxy decision. |
| AI provider abstraction | partial | Interface and Anthropic example exist; robust payload, redaction, retries and reporting are incomplete. |
| JSON/HTML summary | not implemented | Playwright HTML reporter is configured, custom report is not. |
| URL discovery | not implemented | Specification only. |
| Local dashboard | not implemented | Future scope. |
| CI | scaffold | Basic workflow exists; browser caching, snapshot policy and branch protection are external. |

## Rule for updates

Every feature PR must update this table. A capability becomes `verified` only after its acceptance tests run successfully in the intended environment.
