# Codex project instructions

Follow `AGENTS.md`. Treat documentation as the intended design and code/tests as the source of current implementation truth.

For each task:

- Read the matching specification and ADRs.
- Create or update `docs/features/<slug>/SPEC.md`.
- Keep changes atomic and PR-sized.
- Run typecheck and the smallest relevant Playwright suite.
- Do not update snapshots unless the task explicitly changes expected UI.
- Do not silently weaken thresholds, masks or waits to make tests pass.
