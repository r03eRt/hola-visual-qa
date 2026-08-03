import type { RedactedEvidence } from '../../evidence/contract.js';

/**
 * Pure, text-only rendering of a `RedactedEvidence` bundle into the prompt
 * sent to Anthropic (SPEC-008). No fs/network/Date/random — the caller
 * (`src/ai/anthropic/provider.ts`) owns transport and image attachment.
 *
 * The input is already redacted, so nothing here can leak a secret; the
 * system prompt still instructs the model to never decide pass/fail, to
 * label causes as hypotheses only, and to return strict JSON matching
 * `AiAnalysisSchema` exactly.
 */

const SYSTEM_PROMPT = `You are a deterministic test evidence analyst for automated visual QA.
You will be given already-redacted evidence from a single failed test scenario.

Respond with STRICT JSON only (no prose, no markdown fences) matching exactly this shape:
{
  "summary": string,
  "severitySuggestion": "info" | "low" | "medium" | "high",
  "observedEvidence": string[],
  "hypotheses": string[],
  "recommendedInvestigationSteps": string[],
  "confidence": "low" | "medium" | "high",
  "redactionNotes": { "secretsRedacted": number, "urlParamsRedacted": number, "truncatedFields": number, "droppedConsole": number, "droppedNetwork": number, "droppedErrors": number }
}

Rules:
- Label every possible cause under "hypotheses" — never state a cause as a fact or conclusion.
- Never decide pass/fail; that is a deterministic, non-AI decision made elsewhere.
- Never ask for more data, more logs, or additional access; analyze only what is provided.
- Do not invent evidence that was not provided.
- Output must be a single JSON object and nothing else.`;

export function buildAnalysisPrompt(evidence: RedactedEvidence): { system: string; userText: string } {
  const lines: string[] = [];
  lines.push(`Scenario: ${evidence.scenario.id}`);
  lines.push(`Status: ${evidence.status}`);

  lines.push('Failed checks:');
  if (evidence.failedChecks.length === 0) {
    lines.push('  (none)');
  } else {
    for (const check of evidence.failedChecks) lines.push(`  - ${check}`);
  }

  lines.push('Errors:');
  if (evidence.errors.length === 0) {
    lines.push('  (none)');
  } else {
    for (const error of evidence.errors) {
      lines.push(`  - [${error.severity}] ${error.category}/${error.code}: ${error.message}`);
    }
  }

  lines.push('Console entries:');
  if (evidence.console.length === 0) {
    lines.push('  (none)');
  } else {
    for (const entry of evidence.console) lines.push(`  - [${entry.type}] ${entry.text}`);
  }

  lines.push('Network entries:');
  if (evidence.network.length === 0) {
    lines.push('  (none)');
  } else {
    for (const entry of evidence.network) {
      const status = entry.status !== undefined ? String(entry.status) : 'n/a';
      const failure = entry.failure ? ` (${entry.failure})` : '';
      lines.push(`  - ${entry.method} ${entry.url} -> ${status}${failure}`);
    }
  }

  const notes = evidence.redactionNotes;
  lines.push(
    `Redaction notes: secretsRedacted=${notes.secretsRedacted}, urlParamsRedacted=${notes.urlParamsRedacted}, truncatedFields=${notes.truncatedFields}, droppedConsole=${notes.droppedConsole}, droppedNetwork=${notes.droppedNetwork}, droppedErrors=${notes.droppedErrors}`
  );

  return { system: SYSTEM_PROMPT, userText: lines.join('\n') };
}
