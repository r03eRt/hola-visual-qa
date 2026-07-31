# Current implementation status

Status labels: `scaffold`, `partial`, `implemented`, `verified`.

| Capability | Status | Notes |
|---|---|---|
| Repository bootstrap | partial | Dependency versions are now exact-pinned to the lockfile-resolved versions (no `latest`, no ranges) and `npm ci` succeeds (see `.npmrc`: `legacy-peer-deps=true`, required because `typescript@7.0.2` conflicts with `typescript-eslint@8.65.0`'s declared peer range). `npm run typecheck` passes. `eslint.config.js` (flat config, `@eslint/js` + `typescript-eslint` recommended) is added but **`npm run lint` currently fails to run**: `typescript-eslint` unconditionally throws on TypeScript >=7 (no published or prerelease version supports it yet; upstream tracking issue https://github.com/typescript-eslint/typescript-eslint/issues/10940). The officially documented workaround (aliasing `typescript` to the `@typescript/typescript6` compatibility package for programmatic consumers, per the TS 7 release notes) requires adding packages beyond the two eslint deps this feature is scoped to add, so it was not applied without a spec/scope decision. Lint is blocked until either typescript-eslint ships TS7 support or the toolchain spec is revisited to allow the alias workaround. |
| Scenario matrix | scaffold | Example types and scenarios exist; filtering and validation are incomplete. |
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
