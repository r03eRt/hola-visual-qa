# Baseline policy

- Create baselines only from a known environment.
- Record browser, platform, configuration and commit metadata.
- Review expected/actual/diff together.
- Never update all snapshots casually.
- Prefer targeted update by scenario.
- A PR containing baseline changes explains the product change and affected scenarios.
- Masks and thresholds are reviewed like code.
- Cross-platform baseline strategy must be explicit before macOS/Linux CI comparison.
