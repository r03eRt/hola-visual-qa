import { z } from 'zod';

/**
 * Provider-neutral error contract. See docs/architecture/ERROR_MODEL.md for
 * the canonical category list and the report-safety guarantees this module
 * implements: no raw provider exceptions, secrets or stack traces ever reach
 * `NormalizedError.message`.
 */

export const ErrorCategory = [
  'configuration_error',
  'environment_setup_error',
  'navigation_error',
  'state_verification_error',
  'readiness_timeout',
  'visual_regression',
  'placement_failure',
  'console_error',
  'network_failure',
  'artifact_error',
  'ai_provider_error',
  'internal_error'
] as const;

export const ErrorCategorySchema = z.enum(ErrorCategory);
export type ErrorCategory = z.output<typeof ErrorCategorySchema>;

/** Pipeline phases, per docs/architecture/DATA_FLOW.md (steps 1-14). */
export const Phase = [
  'configuration',
  'planning',
  'context_setup',
  'navigation',
  'state_verification',
  'readiness',
  'assertion',
  'diagnostics',
  'artifacts',
  'reporting',
  'ai_analysis'
] as const;

export const PhaseSchema = z.enum(Phase);
export type Phase = z.output<typeof PhaseSchema>;

export const ErrorSeveritySchema = z.enum(['error', 'warning']);
export type ErrorSeverity = z.output<typeof ErrorSeveritySchema>;

export const NormalizedErrorSchema = z
  .object({
    code: z.string().min(1),
    category: ErrorCategorySchema,
    message: z.string().min(1),
    scenarioId: z.string().min(1).optional(),
    phase: PhaseSchema,
    timestamp: z.iso.datetime(),
    severity: ErrorSeveritySchema,
    evidenceRefs: z.array(z.string().min(1)).optional()
  })
  .strict();

export type NormalizedError = z.output<typeof NormalizedErrorSchema>;

export function parseNormalizedError(input: unknown): NormalizedError {
  return NormalizedErrorSchema.parse(input);
}

/** Context supplied by the caller when normalizing a thrown/caught value. */
export interface NormalizeErrorContext {
  category: ErrorCategory;
  phase: Phase;
  scenarioId?: string;
  /** Explicit override; otherwise ai_provider_error defaults to 'warning'. */
  severity?: ErrorSeverity;
  evidenceRefs?: string[];
}

/**
 * Categories whose failures never flip a passing deterministic run to
 * failing, per ERROR_MODEL.md ("AI provider errors are warnings ... They
 * never convert a passing deterministic test into failure.").
 */
const WARNING_BY_DEFAULT_CATEGORIES: ReadonlySet<ErrorCategory> = new Set(['ai_provider_error']);

// --- Redaction guard -------------------------------------------------------

const REDACTED = '[redacted]';
const REDACTED_PATH = '[redacted-path]';

/**
 * Strips obvious secret-shaped substrings (auth headers, cookie values,
 * api-key-like tokens) out of a free-text message before it is ever stored
 * as report-safe. This is a best-effort guard, not a substitute for keeping
 * secrets out of thrown errors in the first place.
 */
function redactSecrets(message: string): string {
  let redacted = message;

  // Authorization: <scheme> <token>
  redacted = redacted.replace(/authorization\s*:\s*\S+(\s+\S+)?/gi, `authorization: ${REDACTED}`);

  // Cookie: name=value; name2=value2 (redact each value)
  redacted = redacted.replace(/cookie\s*:\s*[^,\n]+/gi, (match) => {
    const [, ...rest] = match.split(/:\s*/);
    const value = rest.join(': ');
    const scrubbedValue = value.replace(/([^=;\s]+)=([^;]+)/g, `$1=${REDACTED}`);
    return `Cookie: ${scrubbedValue}`;
  });

  // key=value style secret fields anywhere in the message (apiKey=..., token=..., etc.)
  redacted = redacted.replace(
    /\b(api[-_]?key|apikey|api[-_]?token|access[-_]?token|secret|password)\s*[=:]\s*\S+/gi,
    `$1=${REDACTED}`
  );

  // sk-... style API tokens (OpenAI/Anthropic-like) anywhere else in the text.
  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED);

  // Absolute filesystem paths (POSIX /a/b… and Windows C:\a\b…) — strip machine
  // paths and the OS username they embed (e.g. Playwright snapshot-assertion
  // errors report `…at /Users/<name>/…/expected.png`). A URL begins with a
  // scheme (http:, file:), so only a whitespace-delimited token that STARTS
  // with '/' and has at least two path segments is treated as a local path.
  redacted = redacted.replace(/(^|\s)(\/[^\s/]+(?:\/[^\s]*)+)/g, `$1${REDACTED_PATH}`);
  redacted = redacted.replace(/\b[A-Za-z]:\\[^\s]+/g, REDACTED_PATH);

  // Bearer <token>
  redacted = redacted.replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`);

  return redacted;
}

/** Extracts a report-safe, single-line message: no stack trace, redacted. */
function toReportSafeMessage(input: unknown): string {
  const rawMessage = input instanceof Error ? input.message : String(input);
  const firstLine = rawMessage.split('\n')[0] ?? rawMessage;
  return redactSecrets(firstLine).trim() || 'An unknown error occurred';
}

function stableCode(category: ErrorCategory, phase: Phase): string {
  return `${category}.${phase}`;
}

/**
 * Normalizes any thrown/caught value into a `NormalizedError`. Never leaks
 * secrets or raw stack traces into `message`. AI-provider errors default to
 * `severity: 'warning'` unless the caller explicitly overrides it.
 */
export function normalizeError(input: unknown, context: NormalizeErrorContext): NormalizedError {
  const severity =
    context.severity ?? (WARNING_BY_DEFAULT_CATEGORIES.has(context.category) ? 'warning' : 'error');

  const normalized: NormalizedError = {
    code: stableCode(context.category, context.phase),
    category: context.category,
    message: toReportSafeMessage(input),
    phase: context.phase,
    timestamp: new Date().toISOString(),
    severity,
    ...(context.scenarioId !== undefined ? { scenarioId: context.scenarioId } : {}),
    ...(context.evidenceRefs !== undefined ? { evidenceRefs: context.evidenceRefs } : {})
  };

  return NormalizedErrorSchema.parse(normalized);
}
