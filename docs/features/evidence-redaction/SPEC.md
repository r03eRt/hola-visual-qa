# Feature SPEC — evidence-redaction

- Roadmap item: 25
- Issue: #53
- Canonical: SPEC-008 (AI input), SPEC-009 (reporting), `docs/security/SECURITY_AND_PRIVACY.md`
- Type: `feature` + `security`
- Branch: `feature/evidence-redaction`

## Summary

Add a pure, provider-neutral capability that turns raw deterministic failure
evidence into a **redacted, size-limited evidence bundle** with **redaction
notes**. This bundle is the exact input the optional AI analysis (#26/#27) and
the HTML report (#28) will consume. It performs **no AI call, no network and no
filesystem I/O** — hermetic and deterministic.

## Motivation

`docs/security/SECURITY_AND_PRIVACY.md` requires redaction of cookies,
authorization, API keys, tokens and configured sensitive query parameters, an
explicit evidence policy with size limits, and that full response bodies are
never included unless approved. SPEC-008 lists "sanitized logs", "images when
policy permits" and "redaction notes". This feature centralizes those controls
so no sensitive content can reach an AI provider, a persisted artifact or a
committed report.

## Scope (this PR)

New module `src/evidence/`:

- `redact-text.ts` (SECURITY-CRITICAL, pure, no fs/Date/random/env):
  - `redactSecrets(text): { text, count }` — replaces well-known secret shapes
    with `[REDACTED]` and returns how many replacements happened. Patterns:
    `Bearer <token>` / `Authorization: <value>`, JWTs
    (`eyJ...\.<b64>\.<b64>`), OpenAI/Anthropic-style keys (`sk-...`,
    `sk-ant-...`, `sk_live_...`), `Cookie:`/`Set-Cookie:` header values,
    `password=`/`token=`/`secret=`/`api_key=` `key=value` pairs, and long
    high-signal `key`/`token`/`secret`/`password` JSON-ish assignments. Chosen
    conservatively to avoid false positives on ordinary prose.
  - `redactUrlParams(url, sensitiveParams): { url, count }` — parses the URL,
    **keeps** non-sensitive query params but replaces the value of any param
    whose name matches `sensitiveParams` (case-insensitive) with `REDACTED`,
    and strips the fragment. Falls back to stripping the entire query+fragment
    when the URL is unparseable (safe default). Never throws.
  - `truncate(text, maxChars): { text, truncated }` — cuts to `maxChars` and
    appends a `…[+N chars]` marker; `truncated` is `true` when it cut.
- `contract.ts`: strict Zod `RedactedEvidenceSchema` + `EvidenceInput` type +
  `RedactionNotes`.
- `build.ts`: pure `buildRedactedEvidence(input, policy): RedactedEvidence`.
- `index.ts`: barrel.

Config (`src/config/schema.ts`):

- `EvidencePolicySchema` (`.strict()`, every field defaulted):
  `sensitiveQueryParams: string[]` (default `['token','access_token','api_key',
  'apikey','key','password','secret','sig','signature','auth','session']`),
  `maxConsoleEntries` (default 50), `maxNetworkEntries` (default 50),
  `maxErrors` (default 20), `maxFieldChars` (default 2000),
  `includeImages: boolean` (default true — references only),
  `includeResponseBodies: boolean` (default false).
- `evidence: EvidencePolicySchema.optional()` on `ProjectConfig` — **optional so
  existing configs/literals are unaffected**.
- Export `type EvidencePolicy` and a helper
  `resolveEvidencePolicy(config): EvidencePolicy` = `EvidencePolicySchema.parse(
  config.evidence ?? {})` so the schema is the single source of defaults (no
  drift between config and the evidence module).

## Evidence bundle shape (`RedactedEvidence`)

- `scenario`: reuse `ScenarioSchema` from `src/domain` (already strict +
  secret-key-guarded).
- `status`: `ScenarioStatus`.
- `errors`: `[{ code, category, message, severity }]` — `message` redacted +
  truncated; capped at `maxErrors`.
- `failedChecks: string[]` — `"<category>: <redacted+truncated message>"` for
  each non-warning error (deterministic, ordered).
- `console`: `[{ type, text }]` — `text` redacted + truncated; capped at
  `maxConsoleEntries`.
- `network`: `[{ url, method, status?, failure? }]` — `url` param-redacted;
  **headers dropped entirely** from the bundle; `failure` redacted+truncated;
  capped at `maxNetworkEntries`. No response bodies (field only ever present
  when `includeResponseBodies` is true — not populated in this PR).
- `artifacts`: relative refs mirroring `ArtifactRefs`; image refs
  (`expected`/`actual`/`diff`) included only when `includeImages`.
- `redactionNotes`: `{ secretsRedacted, urlParamsRedacted, truncatedFields,
  droppedConsole, droppedNetwork, droppedErrors }` — non-negative integer
  counts of everything withheld.

`RedactedEvidenceSchema` is `.strict()` and secret-key-guarded (its own
`rejectSecretLikeKeys` refine), so it can be persisted or sent to a provider
safely.

## Security requirements

- Every free-text field (error/console/pageError messages, network `failure`)
  passes through `redactSecrets` before it can leave the process.
- Every URL passes through `redactUrlParams`; fragments always stripped.
- Network **headers are never carried** into the bundle (defense in depth,
  even though the diagnostics collector already drops sensitive ones).
- Response **bodies are never included** unless `includeResponseBodies` is true;
  this PR never populates a body field.
- Image evidence is **references only**, gated by `includeImages`; no inline
  image bytes ever enter the bundle.
- The bundle schema rejects any secret-looking top-level key.

## Acceptance criteria

- [x] `redactSecrets` replaces bearer tokens, JWTs, `sk-`/`sk-ant-` keys,
      cookie/authorization values and `token=/password=/secret=` pairs with
      `[REDACTED]`, counts them, and leaves ordinary prose untouched.
- [x] `redactUrlParams` keeps benign query params, replaces sensitive param
      values with `REDACTED`, strips the fragment, counts replacements, and
      falls back to full-query stripping for unparseable input without throwing.
- [x] `truncate` cuts at `maxChars` with a marker and reports `truncated`.
- [x] `buildRedactedEvidence` produces a schema-valid bundle: text fields
      redacted+truncated, URLs param-redacted, network headers absent, image
      refs present only when `includeImages`, entry counts capped, and
      `redactionNotes` counts exactly matching what was withheld.
- [x] A distinctive secret value planted in an error message, a console entry,
      a URL query param and a `failure` string never appears anywhere in
      `JSON.stringify(bundle)`.
- [x] `EvidencePolicySchema` parses `{}` to documented defaults, is `.strict()`,
      and `ProjectConfig` stays valid when `evidence` is omitted;
      `resolveEvidencePolicy` returns a fully-defaulted policy.
- [x] Hermetic: no network, no fs, no browser fixture. `npm run typecheck`,
      `npm run lint`, `npm run test:unit` all green; no existing test changed.

## Non-goals

- The `AiProvider` interface / any Claude call (#26/#27).
- Writing the HTML report or any file (#28 / artifacts writer).
- Reading diagnostics/artifacts from disk or wiring into a live run.
- Changing existing config or manifest literals.

## Definition of done

Acceptance criteria pass with hermetic tests; `docs/STATUS.md` and this SPEC
reflect reality (capability implemented, wiring deferred); security implications
(secret/URL redaction, size limits, no bodies, refs-only images) reviewed by a
read-only security pass; PR stays within scope.
