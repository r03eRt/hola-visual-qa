/**
 * Minimal DI structural interface covering only the Playwright `Page`
 * methods the readiness policy uses. A real Playwright `Page` satisfies
 * this shape, so `preparePage` can run against either a real page or a
 * hermetic fake in unit tests. Deliberately excludes `waitForTimeout` —
 * the readiness policy must never rely on arbitrary sleeps.
 */
export interface StabilityPageLike {
  waitForLoadState(
    state?: 'domcontentloaded' | 'load' | 'networkidle',
    options?: { timeout?: number }
  ): Promise<void>;

  waitForFunction<Arg = unknown>(
    pageFunction: string | ((arg: Arg) => unknown),
    arg?: Arg,
    options?: { timeout?: number; polling?: 'raf' | number }
  ): Promise<unknown>;

  emulateMedia(options: { reducedMotion?: 'reduce' | 'no-preference' }): Promise<void>;

  addStyleTag(options: { content: string }): Promise<unknown>;

  evaluate<R, Arg = unknown>(pageFunction: string | ((arg: Arg) => R | Promise<R>), arg?: Arg): Promise<R>;
}
