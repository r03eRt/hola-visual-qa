# Canonical context packet

## Why this project exists

Hola needs a local-first visual QA tool capable of opening web pages under controlled combinations of device, consent, advertising state, country and user state. It should detect regressions before release, collect evidence and explain failures in language useful to developers and advertising teams.

The original idea was an “AI visual QA agent”. The chosen architecture deliberately separates deterministic browser automation from AI interpretation. Playwright executes and judges tests. An optional Claude integration explains evidence after a failure.

## User intent and working constraints

- The project is developed locally in VS Code with coding agents.
- It should require no hosted backend or database for the MVP.
- An external API is allowed only for optional AI analysis.
- Anthropic Claude can be used through the Anthropic API; a Claude web/enterprise subscription must not be assumed to include API usage.
- Every new feature must be isolated in its own branch and PR.
- The repository must provide enough architecture and documentation for a new agent to continue without prior conversation context.

## Desired end-state

A developer runs a CLI or local interface, chooses URLs and a scenario matrix, and receives:

- deterministic visual comparison;
- screenshot baseline, actual and diff;
- browser trace and optional video;
- console/page/network diagnostics;
- ad-placement and layout observations;
- structured JSON and human-readable HTML output;
- optional AI explanation and suggested investigation steps.

## MVP boundary

The first useful release supports configured URLs, Chromium desktop/mobile, accepted/rejected consent, enabled/disabled ad state, one controlled country override, screenshot comparison and failure diagnostics. No cloud service, production monitoring, autonomous baseline approval or LLM pass/fail.

## Important distinction

Specifications describe the intended product. `docs/STATUS.md` records what is actually implemented. Never confuse the two.
