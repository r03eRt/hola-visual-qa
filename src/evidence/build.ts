import { redactSecrets, redactUrlParams, truncate } from './redact-text.js';
import { RedactedEvidenceSchema, type EvidenceInput, type RedactedEvidence } from './contract.js';
import type { ArtifactRefs } from '../domain/result.js';
import type { EvidencePolicy } from '../config/schema.js';

/**
 * Pure builder that turns raw deterministic failure evidence into a
 * redacted, size-limited `RedactedEvidence` bundle. No AI call, no network
 * and no filesystem I/O — see docs/features/evidence-redaction/SPEC.md.
 */

const IMAGE_ARTIFACT_KEYS = ['expected', 'actual', 'diff'] as const;

export function buildRedactedEvidence(input: EvidenceInput, policy: EvidencePolicy): RedactedEvidence {
  let secretsRedacted = 0;
  let urlParamsRedacted = 0;
  let truncatedFields = 0;

  const redactAndTruncate = (text: string): string => {
    const redacted = redactSecrets(text);
    secretsRedacted += redacted.count;
    const truncated = truncate(redacted.text, policy.maxFieldChars);
    if (truncated.truncated) truncatedFields += 1;
    return truncated.text;
  };

  const cappedErrors = input.errors.slice(0, policy.maxErrors);
  const droppedErrors = Math.max(0, input.errors.length - cappedErrors.length);

  const errors = cappedErrors.map((error) => ({
    code: error.code,
    category: error.category,
    message: redactAndTruncate(error.message),
    severity: error.severity
  }));

  const failedChecks = errors
    .filter((_, index) => cappedErrors[index]?.severity !== 'warning')
    .map((error) => `${error.category}: ${error.message}`);

  const rawConsole = [
    ...(input.diagnostics?.console ?? []).map((entry) => ({ type: entry.type, text: entry.text })),
    ...(input.diagnostics?.pageErrors ?? []).map((entry) => ({ type: 'pageerror', text: entry.message }))
  ];
  const cappedConsole = rawConsole.slice(0, policy.maxConsoleEntries);
  const droppedConsole = Math.max(0, rawConsole.length - cappedConsole.length);

  const console_ = cappedConsole.map((entry) => ({
    type: entry.type,
    text: redactAndTruncate(entry.text)
  }));

  const rawRequests = input.diagnostics?.requests ?? [];
  const cappedRequests = rawRequests.slice(0, policy.maxNetworkEntries);
  const droppedNetwork = Math.max(0, rawRequests.length - cappedRequests.length);

  const network = cappedRequests.map((request) => {
    const redactedUrl = redactUrlParams(request.url, policy.sensitiveQueryParams);
    urlParamsRedacted += redactedUrl.count;

    return {
      url: redactedUrl.url,
      method: request.method,
      ...(request.status !== undefined ? { status: request.status } : {}),
      ...(request.failure !== undefined ? { failure: redactAndTruncate(request.failure) } : {})
    };
  });

  const artifacts = buildArtifacts(input.artifacts, policy.includeImages);

  const candidate = {
    scenario: input.scenario,
    status: input.status,
    errors,
    failedChecks,
    console: console_,
    network,
    ...(artifacts !== undefined ? { artifacts } : {}),
    redactionNotes: {
      secretsRedacted,
      urlParamsRedacted,
      truncatedFields,
      droppedConsole,
      droppedNetwork,
      droppedErrors
    }
  };

  return RedactedEvidenceSchema.parse(candidate);
}

/**
 * Builds the artifact refs carried into the bundle, omitting image refs
 * (`expected`/`actual`/`diff`) when `includeImages` is false. Returns
 * `undefined` when there is nothing left to include.
 */
function buildArtifacts(artifacts: ArtifactRefs | undefined, includeImages: boolean): ArtifactRefs | undefined {
  if (artifacts === undefined) return undefined;

  if (includeImages) return artifacts;

  const filtered: ArtifactRefs = { ...artifacts };
  for (const key of IMAGE_ARTIFACT_KEYS) {
    delete filtered[key];
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}
