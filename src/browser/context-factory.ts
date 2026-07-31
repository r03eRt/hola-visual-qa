import type { BrowserContextOptions, Page } from '@playwright/test';
import type { Scenario } from '../domain/index.js';
import type { ProjectConfig } from '../config/schema.js';
import { buildContextOptions } from './context-options.js';

/**
 * Minimal structural interfaces this module depends on. A real Playwright
 * `Browser`/`BrowserContext` satisfies these shapes, so `launchBrowser()`'s
 * result can be passed directly as a `BrowserLike`; unit tests instead
 * inject a lightweight fake that records calls, keeping `tests/unit`
 * hermetic (no real browser is ever launched there).
 */
export interface BrowserContextLike {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export interface BrowserLike {
  newContext(options: BrowserContextOptions): Promise<BrowserContextLike>;
}

/** Creates a `BrowserContext` for a scenario, using `buildContextOptions`. */
export function createScenarioContext(
  browser: BrowserLike,
  scenario: Scenario,
  config: ProjectConfig,
  overrides?: BrowserContextOptions
): Promise<BrowserContextLike> {
  return browser.newContext(buildContextOptions(scenario, config, overrides));
}

/** Creates a scenario context and opens a single page in it. */
export async function newScenarioPage(
  browser: BrowserLike,
  scenario: Scenario,
  config: ProjectConfig,
  overrides?: BrowserContextOptions
): Promise<{ context: BrowserContextLike; page: Page }> {
  const context = await createScenarioContext(browser, scenario, config, overrides);
  const page = await context.newPage();
  return { context, page };
}

/**
 * The primary disposable entry point: creates a scenario context, runs `fn`
 * against it, and ALWAYS closes the context in a `finally` — including when
 * `fn` throws, in which case the throw still propagates to the caller.
 */
export async function withScenarioContext<T>(
  browser: BrowserLike,
  scenario: Scenario,
  config: ProjectConfig,
  fn: (context: BrowserContextLike) => Promise<T>,
  overrides?: BrowserContextOptions
): Promise<T> {
  const context = await createScenarioContext(browser, scenario, config, overrides);
  try {
    return await fn(context);
  } finally {
    await context.close();
  }
}
