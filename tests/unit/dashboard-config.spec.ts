import { test, expect } from '@playwright/test';
import { resolveDashboardConfig, DashboardConfigSchema } from '../../src/dashboard/config.js';

/**
 * Hermetic unit tests for the local-dashboard config (SPEC-011 /
 * local-dashboard-shell). No fs/net/browser.
 */

test.describe('DashboardConfigSchema / resolveDashboardConfig', () => {
  test('defaults to loopback host, port 4123 and allowNonLoopback false', () => {
    const config = resolveDashboardConfig();
    expect(config).toEqual({ host: '127.0.0.1', port: 4123, allowNonLoopback: false });
  });

  test('rejects an unknown top-level key (strict)', () => {
    const result = DashboardConfigSchema.safeParse({ host: '127.0.0.1', somethingUnexpected: true });
    expect(result.success).toBe(false);
  });

  test('rejects an out-of-range port', () => {
    const tooLow = DashboardConfigSchema.safeParse({ port: -1 });
    const tooHigh = DashboardConfigSchema.safeParse({ port: 70_000 });
    expect(tooLow.success).toBe(false);
    expect(tooHigh.success).toBe(false);
  });

  test('accepts port 0 for ephemeral test binds', () => {
    const config = resolveDashboardConfig({ port: 0 });
    expect(config.port).toBe(0);
  });

  test('throws a normalized configuration_error for a non-loopback host without opt-in', () => {
    let thrown: unknown;
    try {
      resolveDashboardConfig({ host: '0.0.0.0' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { category?: string }).category).toBe('configuration_error');
    expect((thrown as { phase?: string }).phase).toBe('configuration');
  });

  test('resolves a non-loopback host when allowNonLoopback is true', () => {
    const config = resolveDashboardConfig({ host: '0.0.0.0', allowNonLoopback: true });
    expect(config.host).toBe('0.0.0.0');
    expect(config.allowNonLoopback).toBe(true);
  });

  test('accepts ::1 and localhost as loopback hosts without opt-in', () => {
    expect(() => resolveDashboardConfig({ host: '::1' })).not.toThrow();
    expect(() => resolveDashboardConfig({ host: 'localhost' })).not.toThrow();
  });
});
