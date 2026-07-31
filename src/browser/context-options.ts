import type { BrowserContextOptions } from '@playwright/test';
import type { Scenario } from '../domain/index.js';
import type { ProjectConfig } from '../config/schema.js';
import { deviceContextOptions } from './devices.js';

/**
 * Builds the `BrowserContextOptions` for a scenario, merging in this order
 * (later wins on key conflict): device profile (`src/browser/devices.ts`) →
 * `{ baseURL: config.baseUrl }` → caller-supplied `overrides`. Kept to device
 * + baseURL only; locale/timezone/consent/reducedMotion belong to other
 * features. Pure function — no I/O, no browser launch.
 */
export function buildContextOptions(
  scenario: Scenario,
  config: ProjectConfig,
  overrides?: BrowserContextOptions
): BrowserContextOptions {
  return {
    ...deviceContextOptions(scenario.device),
    baseURL: config.baseUrl,
    ...overrides
  };
}
