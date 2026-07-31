# Proposed module map

```text
src/
  cli/                 command parsing and exit codes
  config/              env/file loading and Zod schemas
  domain/              provider-neutral types
  inventory/           URL and page definitions
  scenarios/           dimensions, expansion, filters and IDs
  orchestrator/        planning, concurrency and lifecycle
  browser/             Playwright launch/context/page factories
  adapters/
    consent/            apply/verify consent state
    country/            internal header/cookie/proxy strategy
    ads/                enabled, disabled and deterministic creatives
    user/               anonymous/auth fixture strategy
  stability/            fonts, animation, lazy-load and readiness policies
  visual/               screenshot targets, masks and thresholds
  placements/           discovery, request/render/layout checks
  diagnostics/          console, page errors, network and performance events
  artifacts/            paths, retention and run manifest
  reporting/            normalized JSON and local HTML report
  ai/                   provider interface, redaction and Claude adapter
  security/             URL allowlist and evidence policy
  utils/                small shared helpers only
```

Tests mirror the module structure. End-to-end tests live under `tests/e2e`, while fixtures for deterministic pages live under `tests/fixtures/site`.
