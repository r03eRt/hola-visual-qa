import { test, expect } from '@playwright/test';
import { ProjectConfigSchema, type ProjectConfig } from '../../src/config/schema.js';
import type { StabilityPageLike } from '../../src/stability/page-like.js';
import {
  DEFAULT_READINESS_POLICY,
  readinessPolicyFromConfig,
  type ReadinessPolicy
} from '../../src/stability/policy.js';
import {
  ReadinessTimeoutError,
  preparePage,
  resolveMaskSelectors,
  type ReadinessStepName
} from '../../src/stability/readiness.js';

function minimalConfig(overrides: Partial<{ animations: 'disabled' | 'allow' }> = {}): ProjectConfig {
  return ProjectConfigSchema.parse({
    schemaVersion: 1,
    projectName: 'hola-visual-qa',
    baseUrl: 'https://example.com',
    allowedHosts: ['example.com'],
    pages: [{ path: '/' }],
    dimensions: {
      device: ['desktop', 'mobile'],
      consent: ['accepted', 'rejected'],
      country: ['ES'],
      ads: [true, false]
    },
    visual: overrides.animations ? { animations: overrides.animations } : undefined
  });
}

type CallName = 'waitForLoadState' | 'waitForFunction' | 'emulateMedia' | 'addStyleTag' | 'evaluate';

interface FakePageOptions {
  /** Call names (in the order they are invoked) that should reject instead of resolving. */
  rejectCalls?: CallName[];
  /** Scripted resolved values for `evaluate`, returned in call order. */
  evaluateResults?: unknown[];
}

/** Fake `StabilityPageLike` recording every call, in order, with scriptable rejection. */
class FakeStabilityPage implements StabilityPageLike {
  readonly calls: { name: CallName; args: unknown[] }[] = [];
  private readonly rejectCalls: Set<CallName>;
  private readonly evaluateResults: unknown[];
  private evaluateCallIndex = 0;

  constructor(options: FakePageOptions = {}) {
    this.rejectCalls = new Set(options.rejectCalls ?? []);
    this.evaluateResults = options.evaluateResults ?? [];
  }

  async waitForLoadState(state?: string, options?: { timeout?: number }): Promise<void> {
    this.calls.push({ name: 'waitForLoadState', args: [state, options] });
    if (this.rejectCalls.has('waitForLoadState')) throw new Error('boom: waitForLoadState');
  }

  async waitForFunction(
    pageFunction: unknown,
    arg?: unknown,
    options?: { timeout?: number }
  ): Promise<unknown> {
    this.calls.push({ name: 'waitForFunction', args: [pageFunction, arg, options] });
    if (this.rejectCalls.has('waitForFunction')) throw new Error('boom: waitForFunction');
    return undefined;
  }

  async emulateMedia(options: { reducedMotion?: 'reduce' | 'no-preference' }): Promise<void> {
    this.calls.push({ name: 'emulateMedia', args: [options] });
    if (this.rejectCalls.has('emulateMedia')) throw new Error('boom: emulateMedia');
  }

  async addStyleTag(options: { content: string }): Promise<unknown> {
    this.calls.push({ name: 'addStyleTag', args: [options] });
    if (this.rejectCalls.has('addStyleTag')) throw new Error('boom: addStyleTag');
    return undefined;
  }

  async evaluate<R>(pageFunction: unknown, arg?: unknown): Promise<R> {
    this.calls.push({ name: 'evaluate', args: [pageFunction, arg] });
    if (this.rejectCalls.has('evaluate')) throw new Error('boom: evaluate');
    const value = this.evaluateResults[this.evaluateCallIndex];
    this.evaluateCallIndex += 1;
    return value as R;
  }

  orderedStepNames(): CallName[] {
    return this.calls.map((call) => call.name);
  }
}

test.describe('StabilityPageLike', () => {
  test('has no waitForTimeout in its interface/usage', () => {
    const page = new FakeStabilityPage();
    expect((page as unknown as { waitForTimeout?: unknown }).waitForTimeout).toBeUndefined();
  });
});

test.describe('DEFAULT_READINESS_POLICY', () => {
  test('matches the documented defaults', () => {
    expect(DEFAULT_READINESS_POLICY).toEqual({
      waitForDomState: 'load',
      waitForFonts: true,
      animations: 'disabled',
      lazyLoad: { enabled: true, steps: 8 },
      freezeTime: false,
      maskSelectors: ['[data-visual-mask]'],
      timeoutMs: 10_000
    });
  });
});

test.describe('readinessPolicyFromConfig', () => {
  test('maps VisualPolicy.animations "disabled" from config', () => {
    const config = minimalConfig({ animations: 'disabled' });
    const policy = readinessPolicyFromConfig(config);
    expect(policy.animations).toBe('disabled');
  });

  test('maps VisualPolicy.animations "allow" from config', () => {
    const config = minimalConfig({ animations: 'allow' });
    const policy = readinessPolicyFromConfig(config);
    expect(policy.animations).toBe('allow');
  });

  test('overrides win over the config mapping', () => {
    const config = minimalConfig({ animations: 'disabled' });
    const policy = readinessPolicyFromConfig(config, { animations: 'allow', timeoutMs: 5_000 });
    expect(policy.animations).toBe('allow');
    expect(policy.timeoutMs).toBe(5_000);
  });

  test('falls back to other defaults untouched', () => {
    const config = minimalConfig({ animations: 'allow' });
    const policy = readinessPolicyFromConfig(config);
    expect(policy.lazyLoad).toEqual({ enabled: true, steps: 8 });
    expect(policy.maskSelectors).toEqual(['[data-visual-mask]']);
  });
});

test.describe('preparePage - ordered steps', () => {
  test('runs DOM, app-ready, fonts, animations, lazy-load, freeze-time in order, each recorded', async () => {
    const page = new FakeStabilityPage({ evaluateResults: [undefined, true, undefined] });
    const policy: ReadinessPolicy = {
      ...DEFAULT_READINESS_POLICY,
      appReadyExpression: 'window.__APP_READY__ === true',
      freezeTime: true
    };

    const result = await preparePage(page, policy);

    const stepNames: ReadinessStepName[] = result.steps.map((step) => step.name);
    expect(stepNames).toEqual(['dom', 'app-ready', 'fonts', 'animations', 'lazy-load', 'freeze-time']);
    expect(result.steps.every((step) => step.ran)).toBe(true);

    // Underlying calls happened in the same relative order.
    expect(page.orderedStepNames()).toEqual([
      'waitForLoadState', // dom
      'waitForFunction', // app-ready
      'waitForFunction', // fonts
      'emulateMedia', // animations
      'addStyleTag', // animations
      'evaluate', // lazy-load
      'evaluate', // freeze-time support check
      'evaluate' // freeze-time
    ]);
  });

  test('skips app-ready wait when appReadyExpression is omitted', async () => {
    const page = new FakeStabilityPage();
    const result = await preparePage(page, DEFAULT_READINESS_POLICY);

    const appReadyStep = result.steps.find((step) => step.name === 'app-ready');
    expect(appReadyStep?.ran).toBe(false);
    expect(page.calls.some((call) => call.name === 'waitForFunction' && String(call.args[0]).includes('__APP_READY__'))).toBe(
      false
    );
  });

  test('skips fonts wait when waitForFonts is false', async () => {
    const page = new FakeStabilityPage();
    const policy: ReadinessPolicy = { ...DEFAULT_READINESS_POLICY, waitForFonts: false };

    const result = await preparePage(page, policy);

    const fontsStep = result.steps.find((step) => step.name === 'fonts');
    expect(fontsStep?.ran).toBe(false);
    expect(page.calls.filter((call) => call.name === 'waitForFunction')).toHaveLength(0);
  });
});

test.describe('preparePage - animations', () => {
  test('applies emulateMedia(reduce) + narrow CSS when animations === "disabled"', async () => {
    const page = new FakeStabilityPage();
    const policy: ReadinessPolicy = { ...DEFAULT_READINESS_POLICY, lazyLoad: { enabled: false, steps: 8 } };

    await preparePage(page, policy);

    const emulateCall = page.calls.find((call) => call.name === 'emulateMedia');
    expect(emulateCall?.args[0]).toEqual({ reducedMotion: 'reduce' });

    const styleCall = page.calls.find((call) => call.name === 'addStyleTag');
    const content = (styleCall?.args[0] as { content: string }).content;
    expect(content).toContain('animation: none');
    expect(content).toContain('transition: none');
    expect(content).toContain('caret-color: transparent');
    // Must not hide arbitrary elements — masking is selector-declared, applied at snapshot time.
    expect(content).not.toContain('visibility: hidden');
    expect(content).not.toContain('display: none');
  });

  test('does not touch emulateMedia/addStyleTag when animations === "allow"', async () => {
    const page = new FakeStabilityPage();
    const policy: ReadinessPolicy = { ...DEFAULT_READINESS_POLICY, animations: 'allow', lazyLoad: { enabled: false, steps: 8 } };

    const result = await preparePage(page, policy);

    expect(page.calls.some((call) => call.name === 'emulateMedia')).toBe(false);
    expect(page.calls.some((call) => call.name === 'addStyleTag')).toBe(false);
    expect(result.steps.find((step) => step.name === 'animations')?.ran).toBe(false);
  });
});

test.describe('preparePage - lazy-load', () => {
  test('scrolls in `steps` increments and returns to top via a single evaluate call, no waitForTimeout', async () => {
    const page = new FakeStabilityPage();
    const policy: ReadinessPolicy = { ...DEFAULT_READINESS_POLICY, animations: 'allow', lazyLoad: { enabled: true, steps: 4 } };

    await preparePage(page, policy);

    const evaluateCalls = page.calls.filter((call) => call.name === 'evaluate');
    expect(evaluateCalls).toHaveLength(1);
    expect(evaluateCalls[0]?.args[1]).toBe(4);
  });

  test('skips lazy-load when disabled', async () => {
    const page = new FakeStabilityPage();
    const policy: ReadinessPolicy = { ...DEFAULT_READINESS_POLICY, animations: 'allow', lazyLoad: { enabled: false, steps: 8 } };

    const result = await preparePage(page, policy);

    expect(page.calls.some((call) => call.name === 'evaluate')).toBe(false);
    expect(result.steps.find((step) => step.name === 'lazy-load')?.ran).toBe(false);
  });
});

test.describe('preparePage - freeze-time', () => {
  test('sets timeFrozen:true and runs the freeze call when the page reports support', async () => {
    const page = new FakeStabilityPage({ evaluateResults: [true, undefined] });
    const policy: ReadinessPolicy = {
      ...DEFAULT_READINESS_POLICY,
      animations: 'allow',
      lazyLoad: { enabled: false, steps: 8 },
      freezeTime: true
    };

    const result = await preparePage(page, policy);

    expect(result.timeFrozen).toBe(true);
    expect(result.steps.find((step) => step.name === 'freeze-time')?.ran).toBe(true);
    const evaluateCalls = page.calls.filter((call) => call.name === 'evaluate');
    expect(evaluateCalls).toHaveLength(2);
  });

  test('sets timeFrozen:false and does not throw when the page does not support it', async () => {
    const page = new FakeStabilityPage({ evaluateResults: [false] });
    const policy: ReadinessPolicy = {
      ...DEFAULT_READINESS_POLICY,
      animations: 'allow',
      lazyLoad: { enabled: false, steps: 8 },
      freezeTime: true
    };

    const result = await preparePage(page, policy);

    expect(result.timeFrozen).toBe(false);
    expect(result.steps.find((step) => step.name === 'freeze-time')?.ran).toBe(false);
    const evaluateCalls = page.calls.filter((call) => call.name === 'evaluate');
    expect(evaluateCalls).toHaveLength(1); // only the support check, no freeze call
  });

  test('does not run freeze-time check at all when freezeTime is false', async () => {
    const page = new FakeStabilityPage();
    const policy: ReadinessPolicy = { ...DEFAULT_READINESS_POLICY, animations: 'allow', lazyLoad: { enabled: false, steps: 8 } };

    const result = await preparePage(page, policy);

    expect(result.timeFrozen).toBe(false);
    expect(page.calls.some((call) => call.name === 'evaluate')).toBe(false);
  });
});

test.describe('preparePage - named readiness_timeout per condition', () => {
  async function expectNamedTimeout(page: FakeStabilityPage, policy: ReadinessPolicy, nameFragment: string) {
    let thrown: unknown;
    try {
      await preparePage(page, policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ReadinessTimeoutError);
    const error = thrown as ReadinessTimeoutError;
    expect(error.normalized.category).toBe('readiness_timeout');
    expect(error.normalized.phase).toBe('readiness');
    expect(error.message).toContain(nameFragment);
  }

  test('DOM load timeout', async () => {
    const page = new FakeStabilityPage({ rejectCalls: ['waitForLoadState'] });
    await expectNamedTimeout(page, DEFAULT_READINESS_POLICY, 'DOM load');
  });

  test('app-ready signal timeout', async () => {
    const page = new FakeStabilityPage({ rejectCalls: ['waitForFunction'] });
    const policy: ReadinessPolicy = { ...DEFAULT_READINESS_POLICY, appReadyExpression: 'window.__APP_READY__ === true' };
    await expectNamedTimeout(page, policy, 'app-ready signal');
  });

  test('fonts timeout', async () => {
    const page = new FakeStabilityPage({ rejectCalls: ['waitForFunction'] });
    await expectNamedTimeout(page, DEFAULT_READINESS_POLICY, 'fonts');
  });

  test('animations timeout', async () => {
    const page = new FakeStabilityPage({ rejectCalls: ['emulateMedia'] });
    await expectNamedTimeout(page, DEFAULT_READINESS_POLICY, 'animations');
  });

  test('lazy-load timeout', async () => {
    const page = new FakeStabilityPage({ rejectCalls: ['evaluate'] });
    const policy: ReadinessPolicy = { ...DEFAULT_READINESS_POLICY, animations: 'allow' };
    await expectNamedTimeout(page, policy, 'lazy-load scroll');
  });

  test('freeze-time support check timeout (rejection is still reported, not swallowed)', async () => {
    const page = new FakeStabilityPage({ rejectCalls: ['evaluate'] });
    const policy: ReadinessPolicy = {
      ...DEFAULT_READINESS_POLICY,
      animations: 'allow',
      lazyLoad: { enabled: false, steps: 8 },
      freezeTime: true
    };
    await expectNamedTimeout(page, policy, 'freeze-time');
  });

  test('every wait is bounded by policy.timeoutMs', async () => {
    const page = new FakeStabilityPage();
    const policy: ReadinessPolicy = {
      ...DEFAULT_READINESS_POLICY,
      appReadyExpression: 'window.__APP_READY__ === true',
      timeoutMs: 1234
    };

    await preparePage(page, policy);

    const boundedCalls = page.calls.filter((call) => call.name === 'waitForLoadState' || call.name === 'waitForFunction');
    for (const call of boundedCalls) {
      const options = call.args[call.args.length - 1] as { timeout?: number } | undefined;
      expect(options?.timeout).toBe(1234);
    }
  });
});

test.describe('resolveMaskSelectors / ReadinessResult.maskSelectors', () => {
  test('exposes the default declared mask selectors', () => {
    expect(resolveMaskSelectors()).toEqual(['[data-visual-mask]']);
  });

  test('exposes custom declared mask selectors from the policy', () => {
    const policy: ReadinessPolicy = { ...DEFAULT_READINESS_POLICY, maskSelectors: ['#ads', '[data-visual-mask]'] };
    expect(resolveMaskSelectors(policy)).toEqual(['#ads', '[data-visual-mask]']);
  });

  test('ReadinessResult.maskSelectors mirrors the policy', async () => {
    const page = new FakeStabilityPage();
    const policy: ReadinessPolicy = {
      ...DEFAULT_READINESS_POLICY,
      animations: 'allow',
      lazyLoad: { enabled: false, steps: 8 },
      maskSelectors: ['#custom']
    };

    const result = await preparePage(page, policy);

    expect(result.maskSelectors).toEqual(['#custom']);
  });
});
