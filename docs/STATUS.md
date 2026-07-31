# Current implementation status

Status labels: `scaffold`, `partial`, `implemented`, `verified`.

| Capability | Status | Notes |
|---|---|---|
| Repository bootstrap | partial | TypeScript, Playwright config and scripts exist; versions use `latest` and need locking. |
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
