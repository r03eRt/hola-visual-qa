import { z } from 'zod';
import { RedactionNotesSchema } from '../evidence/contract.js';

/**
 * Strict, provider-neutral AI analysis output (SPEC-008 Output). This is the
 * only shape any `AiProvider` implementation may return — no free-form text,
 * no raw evidence echoed back, no secret-looking keys at any object level.
 */

// A conservative, case-insensitive denylist of field names that must never
// appear on the serialized analysis. Mirrors src/evidence/contract.ts'
// SECRET_FIELD_PATTERN/rejectSecretLikeKeys, duplicated locally so this
// module is self-contained (no dependency on the guard being re-exported).
const SECRET_FIELD_PATTERN =
  /^(api[-_]?key|apikey|api[-_]?token|access[-_]?token|authorization|auth|cookie|cookies|secret|password|token|storagestate|storage_state)$/i;

function rejectSecretLikeKeys(shapeName: string) {
  return (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
    for (const key of Object.keys(value)) {
      if (SECRET_FIELD_PATTERN.test(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `${shapeName} must not contain a secret-looking field: "${key}"`,
          path: [key]
        });
      }
    }
  };
}

export const AiSeveritySuggestionSchema = z.enum(['info', 'low', 'medium', 'high']);
export type AiSeveritySuggestion = z.output<typeof AiSeveritySuggestionSchema>;

export const AiConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type AiConfidence = z.output<typeof AiConfidenceSchema>;

export const AiAnalysisSchema = z
  .object({
    summary: z.string().min(1),
    severitySuggestion: AiSeveritySuggestionSchema,
    observedEvidence: z.array(z.string()),
    // Plausible causes only — each entry is a hypothesis, never a conclusion.
    hypotheses: z.array(z.string()),
    recommendedInvestigationSteps: z.array(z.string()),
    confidence: AiConfidenceSchema,
    redactionNotes: RedactionNotesSchema
  })
  .strict()
  .superRefine(rejectSecretLikeKeys('AiAnalysis'));

export type AiAnalysis = z.output<typeof AiAnalysisSchema>;
