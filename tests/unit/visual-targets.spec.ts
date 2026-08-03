import { test, expect } from '@playwright/test';
import type { VisualPolicy } from '../../src/config/schema.js';
import {
  VisualTargetError,
  targetId,
  baselineName,
  resolveTargetPlan,
  type VisualTarget,
  type BaselinePartition,
  type ResolveTargetInput
} from '../../src/visual/index.js';

function policy(overrides: Partial<VisualPolicy> = {}): VisualPolicy {
  return { maxDiffPixelRatio: 0.01, animations: 'disabled', maskSelectors: ['[data-visual-mask]'], ...overrides };
}

const desktopChromeLinux: BaselinePartition = { browser: 'chromium', platform: 'linux', device: 'desktop' };
const mobileChromeLinux: BaselinePartition = { browser: 'chromium', platform: 'linux', device: 'mobile' };
const desktopWebkitMac: BaselinePartition = { browser: 'webkit', platform: 'darwin', device: 'desktop' };

const fullPage: VisualTarget = { kind: 'full-page' };
const viewport: VisualTarget = { kind: 'viewport' };
const component: VisualTarget = { kind: 'component', name: 'Header Nav', selector: '#header-nav' };
const adPlacement: VisualTarget = { kind: 'ad-placement', name: 'Leaderboard Top', selector: '.ad-leaderboard' };

test.describe('targetId', () => {
  test('resolves stable slugs for each kind', () => {
    expect(targetId(fullPage)).toBe('full-page');
    expect(targetId(viewport)).toBe('viewport');
    expect(targetId(component)).toBe('component-header-nav');
    expect(targetId(adPlacement)).toBe('ad-leaderboard-top');
  });

  test('is deterministic across repeated calls', () => {
    expect(targetId(component)).toBe(targetId(component));
    expect(targetId({ kind: 'component', name: 'Header Nav', selector: '#header-nav' })).toBe(
      targetId(component)
    );
  });

  test('slugifies punctuation and mixed case consistently', () => {
    const target: VisualTarget = { kind: 'component', name: '  Hero_Banner!! 2.0  ', selector: '.hero' };
    expect(targetId(target)).toBe('component-hero-banner-2-0');
  });

  test('throws VisualTargetError with configuration_error/planning for empty name', () => {
    const target: VisualTarget = { kind: 'component', name: '   ', selector: '.hero' };
    expect(() => targetId(target)).toThrow(VisualTargetError);
    try {
      targetId(target);
      expect(false).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(VisualTargetError);
      const normalized = (error as VisualTargetError).normalized;
      expect(normalized.category).toBe('configuration_error');
      expect(normalized.phase).toBe('planning');
    }
  });

  test('throws VisualTargetError for empty selector', () => {
    const target: VisualTarget = { kind: 'ad-placement', name: 'Sidebar', selector: '   ' };
    expect(() => targetId(target)).toThrow(VisualTargetError);
  });

  test('throws VisualTargetError when the name slugs to empty', () => {
    const target: VisualTarget = { kind: 'component', name: '!!!', selector: '.hero' };
    expect(() => targetId(target)).toThrow(VisualTargetError);
  });
});

test.describe('baselineName', () => {
  test('is deterministic for the same target and partition', () => {
    expect(baselineName(component, desktopChromeLinux)).toBe(baselineName(component, desktopChromeLinux));
  });

  test('differs across device partitions', () => {
    expect(baselineName(fullPage, desktopChromeLinux)).not.toBe(baselineName(fullPage, mobileChromeLinux));
  });

  test('differs across browser/platform partitions', () => {
    expect(baselineName(fullPage, desktopChromeLinux)).not.toBe(baselineName(fullPage, desktopWebkitMac));
  });

  test('embeds the target id and slugged partition components', () => {
    expect(baselineName(component, desktopChromeLinux)).toBe('component-header-nav__chromium-linux-desktop');
  });

  test('folds in the scenario id when provided, keeping variants distinct', () => {
    const accepted = baselineName(fullPage, { ...desktopChromeLinux, scenarioId: 'home-desktop-accepted-es-ads_on' });
    const rejected = baselineName(fullPage, { ...desktopChromeLinux, scenarioId: 'home-desktop-rejected-es-ads_on' });
    expect(accepted).toBe('full-page__home-desktop-accepted-es-ads-on__chromium-linux-desktop');
    expect(accepted).not.toBe(rejected);
    // Backward compatible: no scenarioId → unchanged name.
    expect(baselineName(fullPage, desktopChromeLinux)).toBe('full-page__chromium-linux-desktop');
  });
});

test.describe('resolveTargetPlan', () => {
  test('resolves full-page: fullPage true, no clipSelector', () => {
    const { plan } = resolveTargetPlan({ target: fullPage, policy: policy(), partition: desktopChromeLinux });
    expect(plan.fullPage).toBe(true);
    expect(plan.clipSelector).toBeUndefined();
  });

  test('resolves viewport: neither fullPage nor clipSelector', () => {
    const { plan } = resolveTargetPlan({ target: viewport, policy: policy(), partition: desktopChromeLinux });
    expect(plan.fullPage).toBe(false);
    expect(plan.clipSelector).toBeUndefined();
  });

  test('resolves component: clipSelector set, fullPage false', () => {
    const { plan } = resolveTargetPlan({ target: component, policy: policy(), partition: desktopChromeLinux });
    expect(plan.fullPage).toBe(false);
    expect(plan.clipSelector).toBe('#header-nav');
  });

  test('resolves ad-placement: clipSelector set, fullPage false', () => {
    const { plan } = resolveTargetPlan({ target: adPlacement, policy: policy(), partition: desktopChromeLinux });
    expect(plan.fullPage).toBe(false);
    expect(plan.clipSelector).toBe('.ad-leaderboard');
  });

  test('copies animations from policy and uses base threshold when no override', () => {
    const { plan, metadata } = resolveTargetPlan({
      target: fullPage,
      policy: policy({ animations: 'allow', maxDiffPixelRatio: 0.05 }),
      partition: desktopChromeLinux
    });
    expect(plan.animations).toBe('allow');
    expect(plan.maxDiffPixelRatio).toBe(0.05);
    expect(metadata.maxDiffPixelRatio).toBe(0.05);
    expect(metadata.thresholdOverride).toBeUndefined();
  });

  test('applies a justified override and preserves it in metadata', () => {
    const input: ResolveTargetInput = {
      target: component,
      policy: policy({ maxDiffPixelRatio: 0.05 }),
      partition: desktopChromeLinux,
      override: { maxDiffPixelRatio: 0.002, justification: 'Header nav has a subtle live clock widget' }
    };
    const { plan, metadata } = resolveTargetPlan(input);
    expect(plan.maxDiffPixelRatio).toBe(0.002);
    expect(metadata.thresholdOverride).toEqual({
      maxDiffPixelRatio: 0.002,
      justification: 'Header nav has a subtle live clock widget'
    });
  });

  test('rejects an override missing justification', () => {
    expect(() =>
      resolveTargetPlan({
        target: fullPage,
        policy: policy(),
        partition: desktopChromeLinux,
        override: { maxDiffPixelRatio: 0.002, justification: '   ' }
      })
    ).toThrow(VisualTargetError);
  });

  test('rejects an override with an out-of-range ratio', () => {
    expect(() =>
      resolveTargetPlan({
        target: fullPage,
        policy: policy(),
        partition: desktopChromeLinux,
        override: { maxDiffPixelRatio: 1.5, justification: 'valid reason' }
      })
    ).toThrow(VisualTargetError);

    expect(() =>
      resolveTargetPlan({
        target: fullPage,
        policy: policy(),
        partition: desktopChromeLinux,
        override: { maxDiffPixelRatio: -0.1, justification: 'valid reason' }
      })
    ).toThrow(VisualTargetError);
  });

  test('throws a normalized configuration_error/planning error for invalid overrides', () => {
    try {
      resolveTargetPlan({
        target: fullPage,
        policy: policy(),
        partition: desktopChromeLinux,
        override: { maxDiffPixelRatio: 2, justification: 'bad ratio' }
      });
      expect(false).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(VisualTargetError);
      const normalized = (error as VisualTargetError).normalized;
      expect(normalized.category).toBe('configuration_error');
      expect(normalized.phase).toBe('planning');
    }
  });

  test('dedupes mask selectors while preserving first-seen order', () => {
    const { plan, metadata } = resolveTargetPlan({
      target: fullPage,
      policy: policy(),
      partition: desktopChromeLinux,
      maskSelectors: ['[data-mask]', '.ad-slot', '[data-mask]', '.clock', '.ad-slot']
    });
    expect(plan.maskSelectors).toEqual(['[data-mask]', '.ad-slot', '.clock']);
    expect(metadata.maskSelectors).toEqual(['[data-mask]', '.ad-slot', '.clock']);
  });

  test('defaults mask selectors to an empty array when not provided', () => {
    const { plan, metadata } = resolveTargetPlan({ target: fullPage, policy: policy(), partition: desktopChromeLinux });
    expect(plan.maskSelectors).toEqual([]);
    expect(metadata.maskSelectors).toEqual([]);
  });

  test('propagates the targetId and baselineName into both plan and metadata', () => {
    const { plan, metadata } = resolveTargetPlan({ target: component, policy: policy(), partition: desktopChromeLinux });
    expect(plan.targetId).toBe('component-header-nav');
    expect(metadata.targetId).toBe('component-header-nav');
    expect(plan.baselineName).toBe(metadata.baselineName);
    expect(metadata.kind).toBe('component');
  });

  test('is deterministic: same inputs produce deeply equal outputs', () => {
    const input: ResolveTargetInput = {
      target: adPlacement,
      policy: policy(),
      partition: mobileChromeLinux,
      maskSelectors: ['.a', '.b']
    };
    const first = resolveTargetPlan(input);
    const second = resolveTargetPlan({ ...input, maskSelectors: ['.a', '.b'] });
    expect(first).toEqual(second);
  });

  test('propagates targetId errors for an invalid named target', () => {
    const invalid: VisualTarget = { kind: 'component', name: '', selector: '.hero' };
    expect(() =>
      resolveTargetPlan({ target: invalid, policy: policy(), partition: desktopChromeLinux })
    ).toThrow(VisualTargetError);
  });
});
