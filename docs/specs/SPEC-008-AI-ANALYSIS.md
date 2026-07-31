# SPEC-008 Optional AI analysis

## Purpose

Turn deterministic failure evidence into a concise explanation, hypotheses and investigation steps.

## Input

Scenario metadata, sanitized logs, expected/actual/diff images when policy permits, failed checks and artifact references.

## Output schema

- summary;
- severity suggestion;
- observed evidence;
- plausible causes labelled as hypotheses;
- recommended investigation steps;
- confidence;
- redaction notes.

## Rules

- Disabled by default.
- Provider-neutral `AiProvider` interface.
- Claude implementation uses an API key supplied at runtime.
- No baseline approval, pass/fail decision or automatic code modification.
- Apply size limits, timeouts, retries and cost controls.
- Never send credentials, cookies, authorization headers or unapproved private content.
