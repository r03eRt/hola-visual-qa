import { devices, type BrowserContextOptions } from '@playwright/test';
import type { Scenario } from '../domain/index.js';

/**
 * Single source of truth for per-device context options. These values MUST
 * stay identical to the `desktop-chromium`/`mobile-chromium` projects in
 * `playwright.config.ts` so screenshots captured through this factory stay
 * pixel-consistent with the existing visual suite. If you change one, change
 * the other and re-verify baselines.
 */
export const DEVICE_PROFILES: Record<Scenario['device'], BrowserContextOptions> = {
  desktop: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  mobile: { ...devices['Pixel 7'] }
};

/** Returns the `BrowserContextOptions` for a scenario's device dimension. */
export function deviceContextOptions(device: Scenario['device']): BrowserContextOptions {
  return DEVICE_PROFILES[device];
}
