import defaultConfigModule from '../../visual-qa.config.js';
import { ProjectConfigSchema, type ProjectConfig } from './schema.js';

/**
 * Aggregated configuration validation failure. All problems found are
 * collected into `issues` and summarized in `message`, per
 * docs/architecture/ERROR_MODEL.md (`configuration_error`).
 */
export class ConfigValidationError extends Error {
  readonly code = 'configuration_error' as const;
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid project configuration:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

/**
 * Applies the explicit allowlist of environment variables that may override
 * committed config fields. Nothing else — and no secret env var — ever
 * reaches the returned config. Overrides are applied before validation, so
 * an invalid override value is still rejected by the schema.
 */
function applyEnvOverrides(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) {
    return raw;
  }

  const config = raw as Record<string, unknown>;
  const overridden: Record<string, unknown> = { ...config };

  if (process.env.BASE_URL) {
    overridden.baseUrl = process.env.BASE_URL;
  }

  if (process.env.TEST_COUNTRY) {
    const existingDimensions =
      typeof config.dimensions === 'object' && config.dimensions !== null
        ? (config.dimensions as Record<string, unknown>)
        : {};
    overridden.dimensions = {
      ...existingDimensions,
      country: [process.env.TEST_COUNTRY]
    };
  }

  return overridden;
}

/**
 * Validates a provided config object, or — when omitted — the committed
 * `visual-qa.config.ts`. Aggregates every validation problem into a single
 * thrown `ConfigValidationError` instead of failing on the first issue.
 */
export function loadConfig(input?: unknown): ProjectConfig {
  const raw = input !== undefined ? input : defaultConfigModule;
  const withOverrides = applyEnvOverrides(raw);
  const result = ProjectConfigSchema.safeParse(withOverrides);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    });
    throw new ConfigValidationError(issues);
  }

  return result.data;
}
