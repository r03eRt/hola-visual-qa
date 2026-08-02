import { test, expect, devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';
import config from '../../playwright.config.js';

/**
 * Hermetic guard for the cross-browser `desktop-webkit` project (SPEC-004
 * baseline partitioning). Imports the committed Playwright config and asserts
 * the project's presence, WebKit engine and viewport. Launches no browser.
 */

interface ProjectView {
  name?: string;
  use?: { viewport?: { width: number; height: number } | null; userAgent?: string };
}

function projects(cfg: PlaywrightTestConfig): ProjectView[] {
  return (cfg.projects ?? []) as ProjectView[];
}

function projectByName(cfg: PlaywrightTestConfig, name: string): ProjectView | undefined {
  return projects(cfg).find((p) => p.name === name);
}

test.describe('playwright projects — desktop-webkit', () => {
  const cfg = config as PlaywrightTestConfig;

  test('exposes the desktop-webkit project alongside the two chromium projects', () => {
    const names = projects(cfg).map((p) => p.name);
    expect(names).toContain('desktop-chromium');
    expect(names).toContain('mobile-chromium');
    expect(names).toContain('desktop-webkit');
  });

  test('desktop-webkit uses the WebKit engine at a 1440x900 viewport', () => {
    const webkit = projectByName(cfg, 'desktop-webkit');
    expect(webkit).toBeDefined();
    expect(webkit?.use?.viewport).toEqual({ width: 1440, height: 900 });

    // Documents that Desktop Safari resolves to the WebKit engine, so this
    // project's screenshots belong to a distinct `webkit` baseline partition.
    expect(devices['Desktop Safari'].defaultBrowserType).toBe('webkit');
    expect(webkit?.use?.userAgent).toBe(devices['Desktop Safari'].userAgent);
  });

  test('the chromium projects remain unchanged', () => {
    expect(projectByName(cfg, 'desktop-chromium')?.use?.viewport).toEqual({ width: 1440, height: 900 });
    expect(projectByName(cfg, 'mobile-chromium')?.use?.userAgent).toBe(devices['Pixel 7'].userAgent);
    expect(devices['Desktop Chrome'].defaultBrowserType).toBe('chromium');
  });
});
