import { AiAnalysisSchema, type AiAnalysis } from '../analysis.js';
import { AiProviderError } from '../contract.js';
import type { RedactedEvidence } from '../../evidence/contract.js';

/**
 * Pure parsing of the raw Anthropic response text into a schema-valid
 * `AiAnalysis` (SPEC-008). Extracts the first JSON object — tolerating a
 * ```json fenced block or surrounding prose — validates it, and always
 * overrides `redactionNotes` with the evidence's own value: the model is
 * never trusted for redaction accounting. Any failure raises an
 * evidence-free `AiProviderError` (never echoes the raw model text or the
 * evidence back into the error message).
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === '\\') {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

export function parseAnalysisResponse(text: string, evidence: RedactedEvidence): AiAnalysis {
  const jsonText = extractFirstJsonObject(text);
  if (jsonText === null) {
    throw new AiProviderError('Anthropic returned an unparseable analysis');
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(jsonText);
  } catch {
    throw new AiProviderError('Anthropic returned an unparseable analysis');
  }

  const result = AiAnalysisSchema.safeParse(candidate);
  if (!result.success) {
    throw new AiProviderError('Anthropic returned an unparseable analysis');
  }

  return { ...result.data, redactionNotes: evidence.redactionNotes };
}
