import { z } from 'zod';
import { ScenarioSchema, ScenarioStatusSchema, ArtifactRefsSchema, type Scenario, type ScenarioStatus, type ArtifactRefs } from '../domain/result.js';
import type { NormalizedError } from '../domain/error.js';
import type { DiagnosticsSnapshot } from '../diagnostics/collector.js';

/**
 * Redacted, size-limited evidence bundle contract (SPEC: evidence-redaction).
 * This is the exact input the optional AI analysis and the HTML report
 * consume — it performs no AI call, no network and no filesystem I/O.
 */

// A conservative, case-insensitive denylist of field names that must never
// appear on the serialized bundle. Mirrors src/domain/result.ts'
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

export const RedactedErrorSchema = z
  .object({
    code: z.string().min(1),
    category: z.string().min(1),
    message: z.string(),
    severity: z.string().min(1)
  })
  .strict();

export type RedactedError = z.output<typeof RedactedErrorSchema>;

export const RedactedConsoleEntrySchema = z
  .object({
    type: z.string().min(1),
    text: z.string()
  })
  .strict();

export type RedactedConsoleEntry = z.output<typeof RedactedConsoleEntrySchema>;

export const RedactedNetworkEntrySchema = z
  .object({
    url: z.string().min(1),
    method: z.string().min(1),
    status: z.number().int().optional(),
    failure: z.string().optional()
  })
  .strict();

export type RedactedNetworkEntry = z.output<typeof RedactedNetworkEntrySchema>;

export const RedactionNotesSchema = z
  .object({
    secretsRedacted: z.number().int().nonnegative(),
    urlParamsRedacted: z.number().int().nonnegative(),
    truncatedFields: z.number().int().nonnegative(),
    droppedConsole: z.number().int().nonnegative(),
    droppedNetwork: z.number().int().nonnegative(),
    droppedErrors: z.number().int().nonnegative()
  })
  .strict();

export type RedactionNotes = z.output<typeof RedactionNotesSchema>;

export const RedactedEvidenceSchema = z
  .object({
    scenario: ScenarioSchema,
    status: ScenarioStatusSchema,
    errors: z.array(RedactedErrorSchema),
    failedChecks: z.array(z.string()),
    console: z.array(RedactedConsoleEntrySchema),
    network: z.array(RedactedNetworkEntrySchema),
    artifacts: ArtifactRefsSchema.optional(),
    redactionNotes: RedactionNotesSchema
  })
  .strict()
  .superRefine(rejectSecretLikeKeys('RedactedEvidence'));

export type RedactedEvidence = z.output<typeof RedactedEvidenceSchema>;

/** Raw, pre-redaction input consumed by `buildRedactedEvidence`. */
export interface EvidenceInput {
  scenario: Scenario;
  status: ScenarioStatus;
  errors: readonly NormalizedError[];
  diagnostics?: DiagnosticsSnapshot;
  artifacts?: ArtifactRefs;
}
