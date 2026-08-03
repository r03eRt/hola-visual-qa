import { z } from 'zod';
import { normalizeError } from '../domain/index.js';

/**
 * Local dashboard bind configuration (SPEC-011 / local-dashboard-shell). PURE
 * module: no fs/net. Defaults keep the dashboard loopback-only; binding to any
 * other host requires an explicit `allowNonLoopback` opt-in, enforced below.
 */

export const DashboardConfigSchema = z
  .object({
    host: z.string().min(1).default('127.0.0.1'),
    port: z.number().int().min(0).max(65535).default(4123),
    allowNonLoopback: z.boolean().default(false)
  })
  .strict();

export type DashboardConfig = z.output<typeof DashboardConfigSchema>;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/**
 * Parses/defaults the dashboard configuration. Throws a normalized
 * `configuration_error` (phase `configuration`) if the resolved host is not a
 * loopback address and the caller has not explicitly opted into
 * `allowNonLoopback`. Never echoes secrets.
 */
export function resolveDashboardConfig(input?: unknown): DashboardConfig {
  const config = DashboardConfigSchema.parse(input ?? {});

  if (!isLoopbackHost(config.host) && !config.allowNonLoopback) {
    throw normalizeError(
      'Dashboard host must be loopback (127.0.0.1, ::1 or localhost) unless allowNonLoopback is explicitly set to true.',
      { category: 'configuration_error', phase: 'configuration' }
    );
  }

  return config;
}
