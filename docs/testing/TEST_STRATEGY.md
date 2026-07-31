# Test strategy

## Layers

- Unit tests for schema, scenario expansion, IDs, filtering, paths, redaction and normalization.
- Integration tests against a local deterministic fixture site.
- End-to-end tests for CLI execution and artifact generation.
- Contract tests for environment adapters.
- Optional provider tests mocked by default; live Anthropic tests are manual and opt-in.

## Fixture site

Create local pages that deliberately produce stable states: accepted/rejected consent, delayed font, animation, failed request, console error, placement empty/rendered/timeout and known layout shifts. Never rely exclusively on a real Hola page for automated test correctness.

## Flake policy

A flaky test is treated as a defect. Do not add retries before understanding the cause. Track retry count separately if CI uses a temporary retry policy.
