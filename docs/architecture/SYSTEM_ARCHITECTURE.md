# System architecture

```text
User / CI
   |
CLI / local dashboard
   |
Configuration loader + schema validation
   |
Scenario planner -------- URL inventory
   |
Run orchestrator
   |
Playwright workers
   |---- environment adapters (country, ads, user, consent)
   |---- page stabilization
   |---- visual assertions
   |---- placement assertions
   |---- diagnostics collector
   |
Artifact store (local filesystem)
   |---- manifest.json
   |---- expected / actual / diff
   |---- trace / video / logs
   |
Report builder
   |
Optional evidence redactor -> AiProvider -> Claude API
```

## Architectural boundaries

### Core

Configuration, planning, execution contracts, result types and artifact conventions. No Anthropic imports.

### Browser adapters

Playwright-specific page/context operations. Each environmental dimension has an adapter with `apply` and `verify` behavior.

### Assertions

Deterministic checks only: screenshot, element state, geometry, request events and timing thresholds.

### Diagnostics

Observes but does not change test outcomes unless a specification explicitly promotes a diagnostic to an assertion.

### Reporting

Consumes normalized results. It must not rerun tests or mutate baselines.

### AI

Consumes a redacted evidence package after deterministic execution. A failure or unavailable API must not invalidate the underlying QA result.
