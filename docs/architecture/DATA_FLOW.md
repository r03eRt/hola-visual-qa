# Data flow

1. Configuration is read from a versioned project file plus environment secrets.
2. Zod validates all configuration before a browser launches.
3. The scenario planner expands dimensions into stable scenario IDs.
4. Filters and safety limits reduce the plan.
5. The orchestrator creates a run ID and manifest.
6. A worker creates an isolated BrowserContext.
7. Adapters apply state before navigation where possible.
8. The page opens and adapters verify the effective state.
9. Readiness and stabilization policies run.
10. Assertions and diagnostic collection execute.
11. Artifacts are written under a scenario-specific directory.
12. Results are normalized and reported.
13. On eligible failures, evidence is redacted and optionally sent to an AI provider.
14. The CLI exits non-zero if deterministic required checks fail.
