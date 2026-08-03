# Feature: anthropic-analysis

## Goal

Provide the **real Anthropic (Claude) adapter** that satisfies the
provider-neutral `AiProvider` contract from feature #26. It turns a
`RedactedEvidence` bundle (#25) into a schema-validated `AiAnalysis` by calling
Anthropic, applying the resolved `AiRequestOptions` (timeout, max output,
attempts, cost). It retires the legacy prototypes.

## Context and linked canonical specs

- `docs/specs/SPEC-008-AI-ANALYSIS.md` — Input/Output/Rules (size limits,
  timeouts, retries, cost controls; never send credentials/cookies/auth
  headers/unapproved content).
- `docs/decisions/ADR-003-PROVIDER-ABSTRACTION.md` — Anthropic is the first
  adapter, not a dependency of domain/execution; **model name is configuration,
  never hard-coded**.
- `src/ai/contract.ts` (#26) — `AiProvider`, `AiAnalysisRequest`,
  `AiRequestOptions`, `AiProviderError`.
- `src/ai/analysis.ts` (#26) — `AiAnalysisSchema` (the only valid output).
- `src/evidence/contract.ts` (#25) — `RedactedEvidence` (the only valid input).

The legacy prototypes `src/ai/{provider,anthropic-provider,factory}.ts` (ad-hoc
string output, direct SDK use, no schema/limits) are **deleted** by this feature
and replaced by the modules below. Nothing else in the codebase imports them
(verified).

## Non-goals

- No orchestrator/reporting/visual-suite wiring (later features).
- No change to the #26 contract or `AiAnalysis` shape.
- No prompt tuning beyond producing valid structured output.

## Proposed interfaces and files

- `src/ai/anthropic/client-port.ts` — minimal structural port
  `AnthropicMessagesClient` = `{ createMessage(params: AnthropicMessageParams,
  signal?: AbortSignal): Promise<AnthropicMessageResult> }`, where params carry
  `model`, `maxOutputTokens`, `system`, and a content array of text/image
  blocks, and the result exposes the concatenated assistant `text` and optional
  token `usage`. **No `@anthropic-ai/sdk` import here.**
- `src/ai/anthropic/image-port.ts` — `ImageLoader` =
  `{ load(ref: string): Promise<{ base64: string; mediaType: string } | null> }`
  (DI; returns null when absent). Keeps fs out of the provider/tests.
- `src/ai/anthropic/prompt.ts` (PURE) — `buildAnalysisPrompt(evidence:
  RedactedEvidence): { system: string; userText: string }`. Text-only rendering
  of scenario id, status, failed checks, redacted errors/console/network and
  `redactionNotes`. Instructs the model to return **strict JSON** matching the
  `AiAnalysis` fields, to label causes as hypotheses, and to **never** decide
  pass/fail or request more data. No secret values can appear (input already
  redacted).
- `src/ai/anthropic/parse.ts` (PURE) — `parseAnalysisResponse(text: string,
  evidence: RedactedEvidence): AiAnalysis`. Extracts the first JSON object,
  validates via `AiAnalysisSchema`, and **overrides `redactionNotes` with
  `evidence.redactionNotes`** (the model is never trusted to report redaction).
  Throws `AiProviderError` (evidence-free) on malformed/invalid output.
- `src/ai/anthropic/provider.ts` — `AnthropicProvider implements AiProvider`
  (`name = 'anthropic'`). Constructed with DI deps `{ client:
  AnthropicMessagesClient; model: string; imageLoader?: ImageLoader }`.
  `analyze(request)`:
  - builds the text prompt; optionally attaches expected/actual/diff images via
    `imageLoader` **only** when `request.evidence.artifacts` provides the ref and
    the loader returns bytes, capped by a documented per-image/byte budget;
  - calls `client.createMessage` with `model`, `maxOutputTokens =
    options.maxOutputTokens`, bounded by `options.timeoutMs` (AbortSignal /
    race) and retried up to `options.maxAttempts` on transient failures;
  - enforces a best-effort `maxCostUsd` guard from reported `usage` (abort/raise
    before/after a call that would exceed budget);
  - parses → `AiAnalysis`; any error becomes a normalized, evidence-free
    `AiProviderError`.
- `src/ai/anthropic/real-client.ts` — the ONLY file importing
  `@anthropic-ai/sdk`; `createAnthropicClient({ apiKey })` adapts the SDK to the
  `AnthropicMessagesClient` port. API key comes from `env.ANTHROPIC_API_KEY`.
- `src/ai/factory.ts` (REPLACED) — `createAiProvider(policy: AiPolicy, deps?):
  AiProvider`. Returns `DisabledAiProvider` unless `isAiEnabled(policy) &&
  policy.provider === 'anthropic'`; otherwise builds an `AnthropicProvider` from
  the real client (api key from env) + a real fs-backed `ImageLoader`, using the
  resolved model. Never throws for the disabled path.
- `src/config/schema.ts` — add optional `model?: string` to `AiPolicySchema`
  (per ADR-003). Backwards compatible.
- `src/ai/index.ts` — extend the barrel with the anthropic module + factory.
- DELETE `src/ai/provider.ts`, `src/ai/anthropic-provider.ts` (old), and replace
  `src/ai/factory.ts`.

## Acceptance criteria

- [x] `AnthropicProvider` implements the #26 `AiProvider` and returns a
      schema-valid `AiAnalysis`, with `redactionNotes` taken from the evidence
      bundle (never the model).
- [x] Prompt/parse modules are pure and hermetically tested with a fake client;
      no `@anthropic-ai/sdk` import outside `real-client.ts`.
- [x] `options.timeoutMs`, `maxAttempts`, `maxOutputTokens` and a best-effort
      `maxCostUsd` guard are enforced (proven with a fake client that hangs /
      fails / reports usage).
- [x] Images are attached only when present via the injected `ImageLoader`; the
      provider does no direct fs I/O and unit tests do no network/fs.
- [x] `createAiProvider` returns `DisabledAiProvider` when AI is disabled or the
      provider is not `anthropic`; the API key is read from env, never from
      config, never embedded in prompts/errors.
- [x] Legacy `src/ai/{provider,anthropic-provider}.ts` removed; factory replaced;
      nothing references the old symbols.
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit` green.

## Test plan

- `tests/unit/anthropic-prompt.spec.ts` — pure prompt building: contains
  scenario id/failed checks/redaction context, asks for strict JSON, never asks
  for pass/fail; no secret-shaped literals in fixtures (placeholders only).
- `tests/unit/anthropic-parse.spec.ts` — parses valid JSON (incl. fenced code
  block); rejects malformed/invalid via `AiProviderError`; forces
  `redactionNotes` from the evidence even if the model lies.
- `tests/unit/anthropic-provider.spec.ts` — fake `AnthropicMessagesClient`
  proving: happy path → `AiAnalysis`; timeout (hanging client) → `AiProviderError`;
  retry then success; retries exhausted → error; image attach only when loader
  returns bytes; error path never echoes evidence (distinctive-marker test);
  cost guard trips on high reported usage.
- `tests/unit/ai-factory.spec.ts` — disabled/none → `DisabledAiProvider`;
  enabled+anthropic (with injected fake deps) → `AnthropicProvider`.
- Hermetic: no browser, no network, no fs, no real API key.

## Security/privacy impact

This is the egress boundary: only the already-redacted `RedactedEvidence` bundle
is serialized into the prompt; images are gated by the bundle's `artifacts` and
size-capped; the API key is read from `env` only and never appears in prompts,
errors or logs; `AiProviderError` is evidence-free. Requires a `security-review`
pass (issue #57 carries `type:security`).

## Baseline impact

None.

## Dependencies and risks

- Builds on #25 (`RedactedEvidence`) and #26 (contract). Uses
  `@anthropic-ai/sdk@0.115.0` (already pinned).
- Risk: SDK response/typing drift — isolated to `real-client.ts`; the rest of
  the feature depends only on the local port.
- Risk: model returns non-JSON — handled by `parse.ts` raising `AiProviderError`.

## Handover notes

Execute with Sonnet against this spec. Keep the SDK import confined to
`real-client.ts`; everything else depends on the local ports so tests stay
hermetic. After implementation: independent review + a `security-review`
subagent pass focused on the egress boundary, then update `docs/STATUS.md` (new
"Anthropic analysis" row) and check this spec's acceptance boxes.
