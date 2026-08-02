import { z } from 'zod';
import { NormalizedErrorSchema, type NormalizedError } from './error.js';

/**
 * Provider-neutral scenario/result/run contracts. See
 * docs/architecture/ARTIFACT_MODEL.md and docs/architecture/DATA_FLOW.md for
 * the shapes and the fields that MUST be excluded (API keys, authorization
 * headers, cookie values, raw storage state). This file defines TYPES and
 * validation only — no path building, run-id generation or manifest writing
 * (that is a later feature).
 */

// A conservative, case-insensitive denylist of field names that must never
// appear on a serialized artifact object, at any level covered by these
// schemas. Keeps secrets out of manifest.json/result.json/summary.json.
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

export const ScenarioStatusSchema = z.enum(['passed', 'failed', 'skipped']);
export type ScenarioStatus = z.output<typeof ScenarioStatusSchema>;

const PageRefSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1).optional()
  })
  .strict();

export const ScenarioSchema = z
  .object({
    id: z.string().min(1),
    page: PageRefSchema,
    device: z.enum(['desktop', 'mobile']),
    consent: z.enum(['accepted', 'rejected']),
    country: z.string().min(1),
    adsEnabled: z.boolean(),
    userFixture: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional()
  })
  .strict()
  .superRefine(rejectSecretLikeKeys('Scenario'));

export type Scenario = z.output<typeof ScenarioSchema>;

/** Relative path strings only — no absolute paths, no inline artifact data. */
const RelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value), {
    message: 'artifact paths must be relative, not absolute'
  });

export const ArtifactRefsSchema = z
  .object({
    expected: RelativePathSchema.optional(),
    actual: RelativePathSchema.optional(),
    diff: RelativePathSchema.optional(),
    console: RelativePathSchema.optional(),
    pageErrors: RelativePathSchema.optional(),
    requests: RelativePathSchema.optional(),
    trace: RelativePathSchema.optional(),
    video: RelativePathSchema.optional(),
    aiAnalysis: RelativePathSchema.optional()
  })
  .strict();

export type ArtifactRefs = z.output<typeof ArtifactRefsSchema>;

export const ScenarioResultSchema = z
  .object({
    scenario: ScenarioSchema,
    status: ScenarioStatusSchema,
    errors: z.array(NormalizedErrorSchema),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    durationMs: z.number().nonnegative(),
    artifacts: ArtifactRefsSchema.optional()
  })
  .strict()
  .superRefine(rejectSecretLikeKeys('ScenarioResult'));

export type ScenarioResult = z.output<typeof ScenarioResultSchema>;

const BrowserInfoSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1)
  })
  .strict();

/**
 * Minimal, manifest-local mirror of `UrlInventorySchema` from
 * src/discovery/contract.ts. Duplicated (rather than imported) so
 * src/domain never depends on src/discovery — see SPEC-010 / the
 * url-sitemap-discovery feature SPEC for the canonical shape.
 */
const ManifestInventorySchema = z
  .object({
    source: z.enum(['sitemap']),
    pages: z.array(
      z
        .object({
          path: z.string().min(1),
          url: z.string().min(1)
        })
        .strict()
    )
  })
  .strict();

export const RunManifestSchema = z
  .object({
    toolVersion: z.string().min(1),
    commitSha: z.string().min(1).optional(),
    os: z.string().min(1),
    browser: BrowserInfoSchema,
    configHash: z.string().min(1),
    baselineHash: z.string().min(1).optional(),
    scenarioIds: z.array(z.string().min(1)),
    inventory: ManifestInventorySchema.optional(),
    createdAt: z.iso.datetime()
  })
  .strict()
  .superRefine(rejectSecretLikeKeys('RunManifest'));

export type RunManifest = z.output<typeof RunManifestSchema>;

const RunCountsSchema = z
  .object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    total: z.number().int().nonnegative()
  })
  .strict();

export type RunCounts = z.output<typeof RunCountsSchema>;

export const RunResultSchema = z
  .object({
    runId: z.string().min(1),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    manifest: RunManifestSchema,
    results: z.array(ScenarioResultSchema),
    counts: RunCountsSchema,
    deterministicFailure: z.boolean()
  })
  .strict()
  .superRefine(rejectSecretLikeKeys('RunResult'));

export type RunResult = z.output<typeof RunResultSchema>;

/** Compact, serializable subset of RunResult for summary.json. */
export const RunSummarySchema = z
  .object({
    runId: z.string().min(1),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    counts: RunCountsSchema,
    deterministicFailure: z.boolean()
  })
  .strict()
  .superRefine(rejectSecretLikeKeys('RunSummary'));

export type RunSummary = z.output<typeof RunSummarySchema>;

// --- Parse helpers -----------------------------------------------------

export function parseScenario(input: unknown): Scenario {
  return ScenarioSchema.parse(input);
}

export function parseScenarioResult(input: unknown): ScenarioResult {
  return ScenarioResultSchema.parse(input);
}

export function parseRunManifest(input: unknown): RunManifest {
  return RunManifestSchema.parse(input);
}

export function parseRunResult(input: unknown): RunResult {
  return RunResultSchema.parse(input);
}

export function parseRunSummary(input: unknown): RunSummary {
  return RunSummarySchema.parse(input);
}

/**
 * A scenario result counts toward deterministic failure when it is not
 * skipped and either its status is 'failed' or it carries at least one
 * error whose severity is not 'warning'. AI-provider warnings alone never
 * flip this to true, per docs/architecture/ERROR_MODEL.md.
 */
function isDeterministicFailure(result: ScenarioResult): boolean {
  if (result.status === 'skipped') {
    return false;
  }

  if (result.status === 'failed') {
    return true;
  }

  return result.errors.some((error: NormalizedError) => error.severity !== 'warning');
}

/** Computes RunResult.deterministicFailure from a set of scenario results. */
export function computeDeterministicFailure(results: readonly ScenarioResult[]): boolean {
  return results.some(isDeterministicFailure);
}
