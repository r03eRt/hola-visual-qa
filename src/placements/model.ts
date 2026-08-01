import { z } from 'zod';

/**
 * Pure, additive domain contract for ad placements. See
 * docs/ads/PLACEMENT_MODEL.md (the canonical placement fields + state
 * machine) and docs/features/placement-contract/SPEC.md. This file defines
 * TYPES and validation only — no DOM access, no browser, no geometry
 * measurement (later items 16-19 consume this contract to do the actual
 * checks).
 */

// A conservative, case-insensitive denylist of field names that must never
// appear on a serialized placement object, mirroring src/domain/result.ts.
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

export const PlacementSizeSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive()
  })
  .strict();

export type PlacementSize = z.output<typeof PlacementSizeSchema>;

export const PlacementVisibilitySchema = z
  .object({
    desktop: z.boolean().default(true),
    mobile: z.boolean().default(true)
  })
  .strict()
  .prefault({});

export type PlacementVisibility = z.output<typeof PlacementVisibilitySchema>;

export const PlacementEventSignalsSchema = z
  .object({
    request: z.string().min(1).optional(),
    render: z.string().min(1).optional()
  })
  .strict();

export type PlacementEventSignals = z.output<typeof PlacementEventSignalsSchema>;

export const PlacementDefinitionSchema = z
  .object({
    id: z.string().min(1),
    pages: z.array(z.string().min(1)).min(1),
    containerSelector: z.string().min(1),
    allowedSizes: z.array(PlacementSizeSchema).min(1),
    visibility: PlacementVisibilitySchema,
    events: PlacementEventSignalsSchema.optional(),
    timeoutMs: z.number().int().positive().default(10_000),
    expectedEmpty: z.boolean().default(false),
    protectedRegions: z.array(z.string().min(1)).default([]),
    screenshotTarget: z.string().min(1).optional()
  })
  .strict()
  .superRefine(rejectSecretLikeKeys('PlacementDefinition'));

export type PlacementDefinition = z.output<typeof PlacementDefinitionSchema>;

export const PlacementStageSchema = z.enum(['applicability', 'container', 'request', 'render']);
export type PlacementStage = z.output<typeof PlacementStageSchema>;

export const PlacementStateSchema = z.enum([
  'skipped',
  'container_missing',
  'container_ready',
  'request_missing',
  'requested',
  'rendered',
  'empty',
  'provider_error',
  'timeout'
]);
export type PlacementState = z.output<typeof PlacementStateSchema>;

export const PlacementObservationSchema = z
  .object({
    placementId: z.string().min(1),
    state: PlacementStateSchema,
    stage: PlacementStageSchema,
    terminal: z.boolean()
  })
  .strict()
  .superRefine(rejectSecretLikeKeys('PlacementObservation'));

export type PlacementObservation = z.output<typeof PlacementObservationSchema>;

export function parsePlacementDefinition(input: unknown): PlacementDefinition {
  return PlacementDefinitionSchema.parse(input);
}
