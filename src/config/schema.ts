import { z } from 'zod';

/**
 * Canonical, non-secret project configuration schema.
 *
 * See docs/architecture/CONFIGURATION_MODEL.md for the contract this schema
 * implements. Every object is `.strict()` so unknown properties fail
 * validation instead of being silently ignored. No secret/credential fields
 * belong here — those live in `src/config/env.ts` and `.env`.
 */

const PageDefinitionSchema = z
  .object({
    path: z.string().min(1, 'page path must not be empty'),
    name: z.string().min(1).optional()
  })
  .strict();

const ScenarioDimensionsSchema = z
  .object({
    device: z.array(z.enum(['desktop', 'mobile'])).min(1).default(['desktop', 'mobile']),
    consent: z.array(z.enum(['accepted', 'rejected'])).min(1).default(['accepted', 'rejected']),
    country: z.array(z.string().min(1)).min(1).default(['ES']),
    ads: z.array(z.boolean()).min(1).default([true, false])
  })
  .strict()
  .prefault({});

const ConsentAdapterConfigSchema = z
  .object({
    cookieName: z.string().min(1).optional(),
    cookieDomain: z.string().min(1).optional()
  })
  .strict()
  .prefault({});

const AdsAdapterConfigSchema = z
  .object({
    strategy: z.enum(['init-script']).default('init-script'),
    flagName: z.string().min(1).optional()
  })
  .strict()
  .prefault({});

const CountryAdapterConfigSchema = z
  .object({
    strategy: z.enum(['header', 'cookie', 'none']).default('none'),
    headerName: z.string().min(1).optional(),
    cookieName: z.string().min(1).optional(),
    cookieDomain: z.string().min(1).optional(),
    debugSignal: z.string().min(1).optional()
  })
  .strict()
  .prefault({});

const UserFixtureDefinitionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    storageStateRef: z.string().min(1).optional()
  })
  .strict();

const UserAdapterConfigSchema = z
  .object({
    debugSignal: z.string().min(1).optional(),
    fixtures: z.array(UserFixtureDefinitionSchema).default([])
  })
  .strict()
  .prefault({});

const AdapterConfigurationSchema = z
  .object({
    consent: ConsentAdapterConfigSchema,
    ads: AdsAdapterConfigSchema,
    country: CountryAdapterConfigSchema,
    user: UserAdapterConfigSchema
  })
  .strict()
  .prefault({});

const VisualPolicySchema = z
  .object({
    maxDiffPixelRatio: z.number().min(0).max(1).default(0.01),
    animations: z.enum(['disabled', 'allow']).default('disabled')
  })
  .strict()
  .prefault({});

const DiagnosticsPolicySchema = z
  .object({
    captureConsole: z.boolean().default(true),
    captureNetwork: z.boolean().default(true),
    ignoredDomains: z.array(z.string().min(1)).default([])
  })
  .strict()
  .prefault({});

const ArtifactPolicySchema = z
  .object({
    outputDir: z.string().min(1).default('reports'),
    retainOnFailureOnly: z.boolean().default(true)
  })
  .strict()
  .prefault({});

const AiPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    provider: z.enum(['anthropic', 'none']).default('none'),
    timeoutMs: z.number().int().min(1).default(30_000),
    maxOutputTokens: z.number().int().min(1).default(1024),
    maxAttempts: z.number().int().min(1).default(2),
    maxCostUsd: z.number().min(0).default(0.5)
  })
  .strict()
  .prefault({});

const ExecutionPolicySchema = z
  .object({
    retries: z.number().int().min(0).default(0),
    workers: z.number().int().min(1).optional()
  })
  .strict()
  .prefault({});

const DiscoveryPolicySchema = z
  .object({
    sitemapUrl: z.string().url().optional(),
    maxUrls: z.number().int().min(1).default(200),
    ignorePathPatterns: z.array(z.string().min(1)).default([])
  })
  .strict();

const EvidencePolicySchema = z
  .object({
    sensitiveQueryParams: z
      .array(z.string().min(1))
      .default(['token', 'access_token', 'api_key', 'apikey', 'key', 'password', 'secret', 'sig', 'signature', 'auth', 'session']),
    maxConsoleEntries: z.number().int().min(0).default(50),
    maxNetworkEntries: z.number().int().min(0).default(50),
    maxErrors: z.number().int().min(0).default(20),
    maxFieldChars: z.number().int().min(1).default(2000),
    includeImages: z.boolean().default(true),
    includeResponseBodies: z.boolean().default(false)
  })
  .strict();

export const ProjectConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectName: z.string().min(1, 'projectName must not be empty'),
    baseUrl: z.string().url('baseUrl must be a valid URL'),
    allowedHosts: z.array(z.string().min(1)).min(1, 'allowedHosts must have at least one host'),
    pages: z.array(PageDefinitionSchema).min(1, 'pages must define at least one page'),
    dimensions: ScenarioDimensionsSchema,
    adapters: AdapterConfigurationSchema,
    visual: VisualPolicySchema,
    diagnostics: DiagnosticsPolicySchema,
    artifacts: ArtifactPolicySchema,
    ai: AiPolicySchema,
    execution: ExecutionPolicySchema,
    discovery: DiscoveryPolicySchema.optional(),
    evidence: EvidencePolicySchema.optional()
  })
  .strict();

export type ProjectConfig = z.output<typeof ProjectConfigSchema>;
export type ProjectConfigInput = z.input<typeof ProjectConfigSchema>;
export type PageDefinition = z.output<typeof PageDefinitionSchema>;
export type ScenarioDimensions = z.output<typeof ScenarioDimensionsSchema>;
export type AdapterConfiguration = z.output<typeof AdapterConfigurationSchema>;
export type VisualPolicy = z.output<typeof VisualPolicySchema>;
export type DiagnosticsPolicy = z.output<typeof DiagnosticsPolicySchema>;
export type ArtifactPolicy = z.output<typeof ArtifactPolicySchema>;
export type AiPolicy = z.output<typeof AiPolicySchema>;
export type ExecutionPolicy = z.output<typeof ExecutionPolicySchema>;
export type DiscoveryPolicy = z.output<typeof DiscoveryPolicySchema>;
export type EvidencePolicy = z.output<typeof EvidencePolicySchema>;

/**
 * Resolves a fully-defaulted `EvidencePolicy` from a `ProjectConfig`, using
 * `EvidencePolicySchema` as the single source of defaults so there is no
 * drift between the config schema and the evidence module that consumes it.
 */
export function resolveEvidencePolicy(config: ProjectConfig): EvidencePolicy {
  return EvidencePolicySchema.parse(config.evidence ?? {});
}
