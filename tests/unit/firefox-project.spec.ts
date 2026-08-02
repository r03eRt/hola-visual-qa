import { test, expect, devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';
import config from '../../playwright.config.js';

/**
 * Hermetic guard for the cross-browser `desktop-firefox` project (SPEC-004
 * baseline partitioning). Imports the committed Playwright config and asserts
 * the project's presence, Firefox engine and viewport. Launches no browser.
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

test.describe('playwright projects — desktop-firefox', () => {
  const cfg = config as PlaywrightTestConfig;

  test('exposes desktop-firefox alongside the chromium and webkit projects', () => {
    const names = projects(cfg).map((p) => p.name);
    expect(names).toContain('desktop-chromium');
    expect(names).toContain('mobile-chromium');
    expect(names).toContain('desktop-webkit');
    expect(names).toContain('desktop-firefox');
  });

  test('desktop-firefox uses the Firefox engine at a 1440x900 viewport', () => {
    const firefox = projectByName(cfg, 'desktop-firefox');
    expect(firefox).toBeDefined();
    expect(firefox?.use?.viewport).toEqual({ width: 1440, height: 900 });

    // Documents that Desktop Firefox resolves to the Gecko/Firefox engine, so
    // this project's screenshots belong to a distinct `firefox` baseline partition.
    expect(devices['Desktop Firefox'].defaultBrowserType).toBe('firefox');
    expect(firefox?.use?.userAgent).toBe(devices['Desktop Firefox'].userAgent);
  });

  test('the other projects remain unchanged', () => {
    expect(projectByName(cfg, 'desktop-chromium')?.use?.viewport).toEqual({ width: 1440, height: 900 });
    expect(projectByName(cfg, 'desktop-webkit')?.use?.userAgent).toBe(devices['Desktop Safari'].userAgent);
    expect(projectByName(cfg, 'mobile-chromium')?.use?.userAgent).toBe(devices['Pixel 7'].userAgent);
  });
});
