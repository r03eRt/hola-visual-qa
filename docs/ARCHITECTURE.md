# Architecture

```text
CLI / Orchestrator
        |
Scenario registry ---- Environment configuration
        |
Playwright runner
   |    |     |
Consent Stability Diagnostics
        |
Deterministic screenshot assertion
        |
Artifacts / HTML report
        |
Optional AI provider -> Claude Messages API
```

The orchestrator selects scenarios and invokes Playwright. Playwright remains the authority for pass/fail. AI receives only failure evidence and returns a human-readable explanation. The `AiProvider` interface permits replacing Claude without changing test execution.
