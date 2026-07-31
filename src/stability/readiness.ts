import { normalizeError, type NormalizedError } from '../domain/error.js';
import { DEFAULT_READINESS_POLICY, type ReadinessPolicy } from './policy.js';
import type { StabilityPageLike } from './page-like.js';

/** Named readiness step recorded in `ReadinessResult.steps`, IN RUN ORDER. */
export type ReadinessStepName = 'dom' | 'app-ready' | 'fonts' | 'animations' | 'lazy-load' | 'freeze-time';

export interface ReadinessStep {
  name: ReadinessStepName;
  ran: boolean;
}

export interface ReadinessResult {
  steps: ReadinessStep[];
  maskSelectors: string[];
  timeFrozen: boolean;
}

/** Thrown when a readiness condition does not complete within `timeoutMs`. */
export class ReadinessTimeoutError extends Error {
  readonly normalized: NormalizedError;

  constructor(condition: string) {
    super(`Readiness timeout: ${condition} did not complete within the configured timeout`);
    this.name = 'ReadinessTimeoutError';
    this.normalized = normalizeError(this.message, {
      category: 'readiness_timeout',
      phase: 'readiness'
    });
  }
}

/** Narrow CSS injected when `animations === 'disabled'`: no element hiding. */
const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

/**
 * Wraps an awaited readiness condition so any timeout/rejection is
 * re-thrown as a normalized `readiness_timeout` naming the failing
 * condition (never a raw provider exception).
 */
async function guarded<T>(condition: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch {
    throw new ReadinessTimeoutError(condition);
  }
}

/** Returns the declared mask selectors for inclusion in reports. */
export function resolveMaskSelectors(policy: ReadinessPolicy = DEFAULT_READINESS_POLICY): string[] {
  return [...policy.maskSelectors];
}

/**
 * Runs the SPEC-003 readiness policy against `page`, IN ORDER: DOM state,
 * app-ready signal (if configured), fonts (if enabled), animation
 * disabling (if configured), controlled lazy-load scrolling (if enabled),
 * and opt-in time freeze (only when the page reports support). Uses NO
 * `waitForTimeout` as a readiness mechanism. Every bounded wait is capped
 * by `policy.timeoutMs`.
 */
export async function preparePage(
  page: StabilityPageLike,
  policy: ReadinessPolicy = DEFAULT_READINESS_POLICY
): Promise<ReadinessResult> {
  const steps: ReadinessStep[] = [];
  const timeout = policy.timeoutMs;

  await guarded('DOM load', () => page.waitForLoadState(policy.waitForDomState, { timeout }));
  steps.push({ name: 'dom', ran: true });

  if (policy.appReadyExpression) {
    const expression = policy.appReadyExpression;
    await guarded('app-ready signal', () => page.waitForFunction(expression, undefined, { timeout }));
    steps.push({ name: 'app-ready', ran: true });
  } else {
    steps.push({ name: 'app-ready', ran: false });
  }

  if (policy.waitForFonts) {
    await guarded('fonts', () =>
      page.waitForFunction("document.fonts.status === 'loaded'", undefined, { timeout })
    );
    steps.push({ name: 'fonts', ran: true });
  } else {
    steps.push({ name: 'fonts', ran: false });
  }

  if (policy.animations === 'disabled') {
    await guarded('animations', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });
    });
    steps.push({ name: 'animations', ran: true });
  } else {
    steps.push({ name: 'animations', ran: false });
  }

  if (policy.lazyLoad.enabled) {
    const stepsCount = policy.lazyLoad.steps;
    await guarded('lazy-load scroll', () =>
      page.evaluate<void, number>(async (count) => {
        const rafAsync = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const scrollHeight = document.documentElement.scrollHeight;
        for (let i = 1; i <= count; i += 1) {
          window.scrollTo(0, Math.round((scrollHeight * i) / count));
          await rafAsync();
        }
        window.scrollTo(0, 0);
        await rafAsync();
      }, stepsCount)
    );
    steps.push({ name: 'lazy-load', ran: true });
  } else {
    steps.push({ name: 'lazy-load', ran: false });
  }

  let timeFrozen = false;
  if (policy.freezeTime) {
    const supportsFreeze = await guarded('freeze-time support check', () =>
      page.evaluate<boolean>("typeof window.__VISUAL_QA_FREEZE_TIME__ === 'function'")
    );
    if (supportsFreeze) {
      await guarded('freeze-time', () => page.evaluate<void>('window.__VISUAL_QA_FREEZE_TIME__()'));
      timeFrozen = true;
      steps.push({ name: 'freeze-time', ran: true });
    } else {
      steps.push({ name: 'freeze-time', ran: false });
    }
  } else {
    steps.push({ name: 'freeze-time', ran: false });
  }

  return { steps, maskSelectors: resolveMaskSelectors(policy), timeFrozen };
}
