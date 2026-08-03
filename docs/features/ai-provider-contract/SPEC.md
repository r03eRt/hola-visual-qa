# Feature: ai-provider-contract

## Goal

Introduce the **provider-neutral AI analysis contract** described by
`docs/specs/SPEC-008-AI-ANALYSIS.md` and `docs/decisions/ADR-003-PROVIDER-ABSTRACTION.md`:
a small `AiProvider` port that consumes the redacted evidence bundle from
feature #25 (`src/evidence` `RedactedEvidence`) and returns a **structured,
schema-validated** `AiAnalysis`. AI is **disabled by default** and the contract
is **provider-neutral** — it contains no Anthropic dependency. The real
Anthropic adapter and any network call are a separate feature (#27
`anthropic-analysis`).

## Context and linked canonical specs

- `docs/specs/SPEC-008-AI-ANALYSIS.md` — Input/Output/Rules.
- `docs/decisions/ADR-003-PROVIDER-ABSTRACTION.md` — small provider-neutral
  interface; model name is configuration, never hard-coded.
- `src/evidence/contract.ts` — `RedactedEvidence` is the only permitted input.
- `src/config/schema.ts` — existing `ai` policy (`enabled`, `provider`).

The legacy prototypes `src/ai/{provider,anthropic-provider,factory}.ts` predate
this contract discipline (ad-hoc string output, direct `@anthropic-ai/sdk`
import, no structured schema, no size/timeout/cost controls). They remain
untouched and unused by the new contract; #27 will rework the Anthropic adapter
against this contract and retire the prototype.

## Non-goals

- No real network/Anthropic call, SDK usage or prompt text (that is #27).
- No wiring into the orchestrator, reporting or visual suite.
- No pass/fail, baseline approval or automatic code modification of any kind.

## Proposed interfaces and files

- `src/ai/analysis.ts` — strict Zod `AiAnalysisSchema` (SPEC-008 Output):
  `summary`, `severitySuggestion` (`info|low|medium|high`), `observedEvidence[]`,
  `hypotheses[]` (each labelled a hypothesis, not a conclusion),
  `recommendedInvestigationSteps[]`, `confidence` (`low|medium|high`),
  `redactionNotes` (reused from evidence). All objects `.strict()` and guarded so
  no secret-looking key can appear. Exported `AiAnalysis` type.
- `src/ai/contract.ts` — the provider-neutral port:
  - `AiAnalysisRequest` = `{ evidence: RedactedEvidence; options: AiRequestOptions }`.
  - `AiRequestOptions` = resolved limits (`timeoutMs`, `maxOutputTokens`,
    `maxAttempts`, `maxCostUsd`) — cost/size/timeout/retry controls per SPEC-008.
  - `AiProvider` = `{ readonly name: string; analyze(request): Promise<AiAnalysis> }`.
  - `AiProviderError` normalized error type (never carries raw evidence).
- `src/ai/disabled-provider.ts` — a `DisabledAiProvider` (name `'none'`) whose
  `analyze()` rejects with a normalized "AI disabled" error; the safe default.
- `src/ai/resolve.ts` (pure) — `resolveAiRequestOptions(policy)` mapping the
  config `ai` policy to `AiRequestOptions` (single source of defaults), and
  `isAiEnabled(policy)`.
- `src/config/schema.ts` — extend `AiPolicySchema` with optional, defaulted
  limits: `timeoutMs`, `maxOutputTokens`, `maxAttempts`, `maxCostUsd`. Backwards
  compatible (existing configs still validate).
- `src/ai/index.ts` — barrel for the new contract modules.

## Acceptance criteria

- [x] `AiAnalysisSchema` validates a well-formed analysis and **rejects** unknown
      keys and any secret-looking field, at every object level.
- [x] `AiProvider` is typed strictly on `RedactedEvidence` in / `AiAnalysis` out;
      no `@anthropic-ai/sdk` import anywhere in the new contract modules.
- [x] `DisabledAiProvider.analyze()` rejects with a normalized, evidence-free
      error and is the default when AI is disabled.
- [x] `resolveAiRequestOptions()` is pure and is the single source of limit
      defaults; `isAiEnabled()` reflects config.
- [x] Extended `ai` config policy is backwards compatible (an empty `ai` block
      and every existing fixture still validate).
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit` all green.

## Test plan

- `tests/unit/ai-analysis-schema.spec.ts` — valid analysis; rejects unknown key;
  rejects secret-looking key; enum bounds for severity/confidence.
- `tests/unit/ai-contract.spec.ts` — `DisabledAiProvider` rejects with the
  normalized error and never echoes evidence; a hand-written fake provider proves
  the port shape and that it consumes a `RedactedEvidence` value.
- `tests/unit/ai-config.spec.ts` — policy defaults, overrides, backwards compat,
  `resolveAiRequestOptions`/`isAiEnabled`.
- Hermetic: no browser, no network, no fs.

## Security/privacy impact

The contract's only input is the already-redacted `RedactedEvidence` bundle, so
credentials, cookies, authorization headers and unapproved private content are
structurally excluded before any provider is involved. The output schema rejects
secret-looking keys. `AiProviderError` must never carry raw evidence. Requires a
`security-review` pass (issue #55 carries `type:security`).

## Baseline impact

None. No snapshot or baseline behaviour changes.

## Dependencies and risks

- Builds on #25 (`RedactedEvidence`). Consumed later by #27 (Anthropic adapter)
  and #29 (failure grouping)/reporting.
- Risk: contract drift from SPEC-008 Output — mitigated by mapping fields 1:1.

## Handover notes

Execute against this spec with Sonnet. Keep AI strictly isolated from
deterministic execution; the default must be a disabled provider. After
implementation: independent review + a security-review subagent pass, then
update `docs/STATUS.md` (new "AI provider contract" row) and this spec's
acceptance checkboxes.
