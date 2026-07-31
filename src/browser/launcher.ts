import { chromium, type Browser, type LaunchOptions } from '@playwright/test';

/**
 * Minimal, documented flags for a deterministic, reproducible Chromium
 * launch. Keep this list small — each flag exists to remove a specific
 * source of non-determinism, not to "harden" the browser generally:
 * - `--disable-dev-shm-usage`: avoids /dev/shm size limits crashing Chromium
 *   in constrained containers/CI runners.
 * - `--force-color-profile=srgb`: pins color management so screenshots are
 *   not affected by the host display's color profile.
 * - `--disable-gpu`: avoids GPU-driver-dependent rendering differences
 *   between machines/CI runners.
 * - `--font-render-hinting=none`: removes host-font-hinting variance from
 *   text rendering, a common source of pixel diffs across machines.
 */
export const DETERMINISTIC_ARGS: readonly string[] = [
  '--disable-dev-shm-usage',
  '--force-color-profile=srgb',
  '--disable-gpu',
  '--font-render-hinting=none'
];

/**
 * Launches Chromium headless with `DETERMINISTIC_ARGS`. Callers may pass
 * `options` to override/extend the defaults (e.g. in tests); explicit
 * `options.args` REPLACES `DETERMINISTIC_ARGS` per Playwright's own merge
 * semantics for `launch()`.
 */
export function launchBrowser(options?: LaunchOptions): Promise<Browser> {
  return chromium.launch({ headless: true, args: [...DETERMINISTIC_ARGS], ...options });
}
