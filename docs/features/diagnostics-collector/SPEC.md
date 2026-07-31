# Feature SPEC — diagnostics-collector (#12)

Ticket: #25 · Branch: `feature/diagnostics-collector` · Roadmap: Browser MVP
Canonical: `docs/specs/SPEC-005-DIAGNOSTICS.md`

## Goal
A deterministic, dependency-injected collector that subscribes to a page's
runtime events and produces the **normalized, secret-free** diagnostic
structures serialized as `console.json`, `page-errors.json` and
`requests.json` (per `docs/architecture/ARTIFACT_MODEL.md`). It applies the
`DiagnosticsPolicy` (captureConsole, captureNetwork, explicit ignoredDomains)
and NEVER stores authorization/cookie headers. No browser is launched in unit
tests. Additive; does not change existing modules.

## Non-goals
- Writing files to disk (the artifact writer from #5 does that later).
- Trace/video capture, timing milestones, screenshot metadata (later features).
- Editing `src/config`/`src/domain`/`playwright.config.ts`. Reuse the existing
  `DiagnosticsPolicy` type from `src/config`.

## New files (only these)
- `src/diagnostics/page-events.ts` — minimal DI interfaces a real Playwright
  `Page` satisfies structurally, plus the emitted-object shapes.
- `src/diagnostics/redact.ts` — header/URL redaction helpers.
- `src/diagnostics/collector.ts` — the collector.
- `src/diagnostics/index.ts` — barrel (`export *`).
- `tests/unit/diagnostics-collector.spec.ts` — hermetic tests (fake emitter).
- `docs/STATUS.md` — one honest row.

## DI event surface — `page-events.ts`
Model ONLY what we consume, structurally compatible with Playwright:
```ts
export type DiagnosticsPageEvent = 'console' | 'pageerror' | 'requestfailed' | 'response';
export interface ConsoleMessageLike { type(): string; text(): string; }
export interface RequestLike {
  url(): string;
  method(): string;
  failure(): { errorText: string } | null;
  headers(): Record<string, string>;
}
export interface ResponseLike {
  url(): string;
  status(): number;
  request(): RequestLike;
  headers(): Record<string, string>;
}
export interface DiagnosticsPageLike {
  on(event: 'console', handler: (msg: ConsoleMessageLike) => void): void;
  on(event: 'pageerror', handler: (error: Error) => void): void;
  on(event: 'requestfailed', handler: (request: RequestLike) => void): void;
  on(event: 'response', handler: (response: ResponseLike) => void): void;
}
```

## Output structures (normalized, secret-free)
```ts
export interface ConsoleEntry { type: string; text: string; }          // severity = type
export interface PageErrorEntry { message: string; stack?: string; }
export interface RequestEntry {
  url: string;                 // redacted (no query string — see redact.ts)
  method: string;
  status?: number;             // present for non-success responses
  failure?: string;            // errorText for failed requests
  headers: Record<string, string>;  // redacted (auth/cookie stripped)
}
export interface DiagnosticsSnapshot {
  console: ConsoleEntry[];
  pageErrors: PageErrorEntry[];
  requests: RequestEntry[];
}
```

## Redaction — `redact.ts` (SECURITY-CRITICAL)
- `redactHeaders(headers)` — returns a NEW object omitting, case-insensitively,
  these keys entirely: `authorization`, `proxy-authorization`, `cookie`,
  `set-cookie`, `x-api-key`, `api-key`, `x-auth-token`, `authentication`.
  (Drop the whole header — do not keep a masked placeholder value that could
  leak length.) Preserve all other headers unchanged, key order stable.
- `redactUrl(url)` — strip the query string and fragment (they can carry
  tokens): return `origin + pathname` when parseable; if the URL cannot be
  parsed, return the substring before the first `?` or `#`. Never throw.
- Pure functions, no fs/Date/random/env.

## Collector — `collector.ts`
```ts
export interface DiagnosticsCollector {
  snapshot(): DiagnosticsSnapshot;   // deep copy, insertion-ordered, deterministic
}
export function createDiagnosticsCollector(
  page: DiagnosticsPageLike,
  policy: DiagnosticsPolicy          // from src/config
): DiagnosticsCollector;
```
Behavior:
- Attaches listeners on construction. Accumulates in insertion order.
- `console` events captured ONLY when `policy.captureConsole` is true; stored
  as `{ type, text }`.
- `pageerror` events ALWAYS captured (uncaught page errors are failures, not
  third-party noise): `{ message, stack? }` from the Error.
- Network (`requestfailed` + non-success `response` where `status >= 400`)
  captured ONLY when `policy.captureNetwork` is true. `response` with
  `status < 400` is ignored.
- `ignoredDomains`: a request/response whose URL host ends with (or equals) any
  configured domain is dropped BEFORE storage (explicit, reviewable noise
  suppression). Matching is on the host of the ORIGINAL url; storage uses the
  REDACTED url. Comparison is case-insensitive; a config entry `example.com`
  matches `example.com` and `a.example.com` but not `notexample.com`.
- ALL stored request/response headers pass through `redactHeaders`; ALL stored
  urls pass through `redactUrl`.
- `snapshot()` returns a deep copy so later mutation of the collector cannot
  change a previously taken snapshot (and vice-versa). Deterministic: same
  event sequence → deeply equal snapshot.

## Acceptance criteria (SPEC-005)
- A fixture event sequence proves EACH type is captured: a console message, a
  page error, a failed request, and a non-success (>=400) response.
- `captureConsole:false` suppresses console entries; `captureNetwork:false`
  suppresses request/response entries; page errors always captured.
- An `ignoredDomains` entry drops matching requests/responses (host + subdomain)
  and nothing else.
- NO stored header includes `authorization`/`cookie`/`set-cookie` (case-
  insensitive) and NO stored url contains a query string — asserted directly.
- Snapshots are deterministic and isolated (deep-copied).

## Verification (all exit 0)
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
- Hermetic: a hand-written fake `DiagnosticsPageLike` records handlers and the
  test drives them synthetically; NO real browser. Do NOT run the visual suite.
