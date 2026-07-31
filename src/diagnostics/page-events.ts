/**
 * Minimal DI structural interfaces covering only the Playwright `Page`
 * events/objects the diagnostics collector consumes. A real Playwright
 * `Page`, `ConsoleMessage`, `Request` and `Response` satisfy these shapes
 * structurally, so `createDiagnosticsCollector` can run against either a
 * real page or a hermetic fake in unit tests. No Playwright import.
 */
export type DiagnosticsPageEvent = 'console' | 'pageerror' | 'requestfailed' | 'response';

export interface ConsoleMessageLike {
  type(): string;
  text(): string;
}

export interface RequestLike {
  url(): string;
  method(): string;
  failure(): { errorText: string } | null;
  headers(): Record<string, string>;
}

export interface ResponseLike {
  url(): string;
  status(): number;
  request(): RequestLike;
  headers(): Record<string, string>;
}

export interface DiagnosticsPageLike {
  on(event: 'console', handler: (msg: ConsoleMessageLike) => void): void;
  on(event: 'pageerror', handler: (error: Error) => void): void;
  on(event: 'requestfailed', handler: (request: RequestLike) => void): void;
  on(event: 'response', handler: (response: ResponseLike) => void): void;
}
