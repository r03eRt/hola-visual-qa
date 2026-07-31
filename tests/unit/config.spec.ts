import { test, expect } from '@playwright/test';
import { ProjectConfigSchema } from '../../src/config/schema.js';
import { loadConfig, ConfigValidationError } from '../../src/config/load-config.js';

function validConfig() {
  return {
    schemaVersion: 1 as const,
    projectName: 'hola-visual-qa',
    baseUrl: 'https://example.com',
    allowedHosts: ['example.com'],
    pages: [{ path: '/' }],
    dimensions: {
      device: ['desktop', 'mobile'],
      consent: ['accepted', 'rejected'],
      country: ['ES'],
      ads: [true, false]
    }
  };
}

test.describe('ProjectConfig schema', () => {
  test('accepts a valid config and fills in defaulted sub-policies', () => {
    const result = ProjectConfigSchema.safeParse(validConfig());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(1);
      expect(result.data.visual).toBeDefined();
      expect(result.data.diagnostics).toBeDefined();
      expect(result.data.artifacts).toBeDefined();
      expect(result.data.ai).toBeDefined();
      expect(result.data.execution).toBeDefined();
      expect(result.data.adapters).toBeDefined();
    }
  });

  test('rejects unknown top-level keys', () => {
    const config = { ...validConfig(), somethingUnexpected: true };
    const result = ProjectConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('rejects unknown keys in nested strict objects', () => {
    const config = validConfig();
    const withUnknownPage = {
      ...config,
      pages: [{ path: '/', bogus: 'nope' }]
    };
    const result = ProjectConfigSchema.safeParse(withUnknownPage);
    expect(result.success).toBe(false);
  });

  test('aggregates multiple validation issues together instead of failing fast', () => {
    const brokenConfig = {
      schemaVersion: 1,
      // missing projectName
      baseUrl: 'not-a-valid-url',
      allowedHosts: [],
      pages: [],
      dimensions: { device: ['not-a-device'] }
    };
    const result = ProjectConfigSchema.safeParse(brokenConfig);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Multiple independent problems must all be reported.
      expect(result.error.issues.length).toBeGreaterThan(1);
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('baseUrl');
      expect(paths.some((p) => p.startsWith('dimensions.device'))).toBe(true);
    }
  });
});

test.describe('loadConfig()', () => {
  test('returns a typed, validated config for a valid input object', () => {
    const config = loadConfig(validConfig());
    expect(config.projectName).toBe('hola-visual-qa');
    expect(config.baseUrl).toBe('https://example.com');
  });

  test('loads the committed visual-qa.config.ts when no input is given', () => {
    const config = loadConfig();
    expect(config.schemaVersion).toBe(1);
    expect(config.pages.length).toBeGreaterThan(0);
  });

  test('throws a single error aggregating all validation problems for invalid input', () => {
    let thrown: unknown;
    try {
      loadConfig({ schemaVersion: 1, baseUrl: 'nope' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConfigValidationError);
    const error = thrown as ConfigValidationError;
    expect(error.issues.length).toBeGreaterThan(1);
  });

  test('applies the allowlisted BASE_URL env override', () => {
    const original = process.env.BASE_URL;
    process.env.BASE_URL = 'https://overridden.example.com';
    try {
      const config = loadConfig(validConfig());
      expect(config.baseUrl).toBe('https://overridden.example.com');
    } finally {
      if (original === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = original;
    }
  });

  test('applies the allowlisted TEST_COUNTRY env override into dimensions.country', () => {
    const original = process.env.TEST_COUNTRY;
    process.env.TEST_COUNTRY = 'FR';
    try {
      const config = loadConfig(validConfig());
      expect(config.dimensions.country).toEqual(['FR']);
    } finally {
      if (original === undefined) delete process.env.TEST_COUNTRY;
      else process.env.TEST_COUNTRY = original;
    }
  });

  test('ignores non-allowlisted env vars', () => {
    const original = process.env.PROJECT_NAME;
    process.env.PROJECT_NAME = 'should-not-apply';
    try {
      const config = loadConfig(validConfig());
      expect(config.projectName).toBe('hola-visual-qa');
    } finally {
      if (original === undefined) delete process.env.PROJECT_NAME;
      else process.env.PROJECT_NAME = original;
    }
  });

  test('never leaks secret-looking fields into the returned config', () => {
    const config = loadConfig(validConfig()) as Record<string, unknown>;
    expect(config).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(config).not.toHaveProperty('apiKey');
    expect(JSON.stringify(config)).not.toContain('ANTHROPIC_API_KEY');
  });
});
