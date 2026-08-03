import type { VisualPolicy } from '../config/schema.js';
import { VisualTargetError, targetId, type VisualTarget } from './target.js';

/** Partitions baselines so cross-browser/platform/device images never compare (SPEC-004). */
export interface BaselinePartition {
  browser: string;
  platform: string;
  device: 'desktop' | 'mobile';
  /**
   * Optional scenario discriminator (e.g. the scenario id encoding
   * page/consent/country/ads). When present it is folded into the baseline
   * name so scenarios that render differently (e.g. consent accepted vs
   * rejected) never share — and thus never overwrite — one baseline.
   */
  scenarioId?: string;
}

/** Lowercase, `[a-z0-9]+` runs joined by `-`, trimmed of leading/trailing dashes. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Deterministic baseline name for `target` partitioned by browser/platform/device
 * and, when supplied, the scenario id:
 * `<targetId>__[<scenarioId>__]<browser>-<platform>-<device>`, all components slugged.
 */
export function baselineName(target: VisualTarget, partition: BaselinePartition): string {
  const id = targetId(target);
  const suffix = [partition.browser, partition.platform, partition.device].map(slugify).join('-');
  const scenarioPart = partition.scenarioId ? `${slugify(partition.scenarioId)}__` : '';
  return `${id}__${scenarioPart}${suffix}`;
}

/** A narrow, justified override of the policy's default `maxDiffPixelRatio`. */
export interface ThresholdOverride {
  maxDiffPixelRatio: number;
  justification: string;
}

/** Resolved, provider-neutral plan handed to a later snapshot-runner's `toHaveScreenshot`. */
export interface ScreenshotAssertionPlan {
  targetId: string;
  baselineName: string;
  /** true only for 'full-page'. */
  fullPage: boolean;
  /** set for 'component' | 'ad-placement'. */
  clipSelector?: string;
  /** effective (override wins). */
  maxDiffPixelRatio: number;
  /** declared masks, deduped, order-stable. */
  maskSelectors: string[];
  animations: 'disabled' | 'allow';
}

/** Embedded in `result.json` alongside the scenario outcome for human review. */
export interface VisualTargetMetadata {
  targetId: string;
  kind: VisualTarget['kind'];
  baselineName: string;
  maxDiffPixelRatio: number;
  /** present only when applied. */
  thresholdOverride?: ThresholdOverride;
  maskSelectors: string[];
}

export interface ResolveTargetInput {
  target: VisualTarget;
  policy: VisualPolicy;
  partition: BaselinePartition;
  /** declared masks (e.g. from readiness policy). */
  maskSelectors?: string[];
  override?: ThresholdOverride;
}

function validateOverride(override: ThresholdOverride): void {
  if (!override.justification.trim()) {
    throw new VisualTargetError('Threshold override requires a non-empty justification');
  }
  if (
    !Number.isFinite(override.maxDiffPixelRatio) ||
    override.maxDiffPixelRatio < 0 ||
    override.maxDiffPixelRatio > 1
  ) {
    throw new VisualTargetError('Threshold override maxDiffPixelRatio must be within [0, 1]');
  }
}

/** Dedupe selectors, preserving first-seen order. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/**
 * Resolves a `VisualTarget` + `VisualPolicy` + baseline partition into a
 * deterministic `ScreenshotAssertionPlan` and its reviewable
 * `VisualTargetMetadata`. Pure: no Date/random/env/fs. Throws
 * `VisualTargetError` (configuration_error/planning) for invalid targets or
 * an unjustified/out-of-range threshold override.
 */
export function resolveTargetPlan(input: ResolveTargetInput): {
  plan: ScreenshotAssertionPlan;
  metadata: VisualTargetMetadata;
} {
  const { target, policy, partition, override } = input;

  if (override) {
    validateOverride(override);
  }

  const id = targetId(target);
  const name = baselineName(target, partition);
  const maskSelectors = dedupe(input.maskSelectors ?? []);
  const maxDiffPixelRatio = override?.maxDiffPixelRatio ?? policy.maxDiffPixelRatio;
  const isNamedRegion = target.kind === 'component' || target.kind === 'ad-placement';

  const plan: ScreenshotAssertionPlan = {
    targetId: id,
    baselineName: name,
    fullPage: target.kind === 'full-page',
    ...(isNamedRegion ? { clipSelector: target.selector } : {}),
    maxDiffPixelRatio,
    maskSelectors,
    animations: policy.animations
  };

  const metadata: VisualTargetMetadata = {
    targetId: id,
    kind: target.kind,
    baselineName: name,
    maxDiffPixelRatio,
    ...(override ? { thresholdOverride: override } : {}),
    maskSelectors
  };

  return { plan, metadata };
}
