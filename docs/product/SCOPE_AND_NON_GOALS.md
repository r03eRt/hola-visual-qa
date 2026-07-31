# Scope and non-goals

## In scope through version 1.0

- Configurable URL inventory.
- Scenario combinations for device, browser, consent, ads, country and optional user fixture.
- Screenshot assertions at page, region and placement level.
- Console, runtime and failed-request capture.
- Ad request/render/container validation.
- Trace/video retention on failure.
- Structured run manifest and custom summary.
- Optional Claude explanation.
- Local CLI and later a local-only dashboard.

## Explicit non-goals

- Replacing functional, accessibility, security or performance testing.
- Monitoring live users or collecting session replay.
- Automatically declaring baseline changes acceptable.
- Sending production cookies or private page content to an LLM without an approved policy.
- Emulating a real country merely by changing locale/geolocation.
- Guaranteeing revenue correctness from visual evidence alone.
- Running arbitrary untrusted scripts from configuration.
