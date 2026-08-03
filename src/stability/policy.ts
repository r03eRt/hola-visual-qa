import type { ProjectConfig } from '../config/schema.js';

/**
 * Deterministic readiness/stabilization policy applied to a page before a
 * visual snapshot is captured. See docs/specs/SPEC-003-PAGE-STABILITY.md.
 */
export interface ReadinessPolicy {
  waitForDomState: 'domcontentloaded' | 'load';
  /**
   * Boolean JS expression evaluated in-page (e.g. `"window.__APP_READY__ ===
   * true"`). Omitted → the app-ready wait is skipped.
   */
  appReadyExpression?: string;
  waitForFonts: boolean;
  animations: 'disabled' | 'allow';
  lazyLoad: { enabled: boolean; steps: number };
  freezeTime: boolean;
  /** Declared dynamic mask selectors, exposed for reports (applied at snapshot time by #10). */
  maskSelectors: string[];
  timeoutMs: number;
}

export const DEFAULT_READINESS_POLICY: ReadinessPolicy = {
  waitForDomState: 'load',
  waitForFonts: true,
  animations: 'disabled',
  lazyLoad: { enabled: true, steps: 8 },
  freezeTime: false,
  maskSelectors: ['[data-visual-mask]'],
  timeoutMs: 10_000
};

/**
 * Builds a `ReadinessPolicy` from the project config, mapping
 * `VisualPolicy.animations`. Explicit `overrides` win over both the config
 * mapping and the defaults.
 */
export function readinessPolicyFromConfig(
  config: ProjectConfig,
  overrides: Partial<ReadinessPolicy> = {}
): ReadinessPolicy {
  return {
    ...DEFAULT_READINESS_POLICY,
    animations: config.visual.animations,
    maskSelectors: config.visual.maskSelectors,
    ...overrides
  };
}
