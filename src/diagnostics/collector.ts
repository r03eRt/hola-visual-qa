import type { Page, TestInfo } from '@playwright/test';
import type { DiagnosticsPolicy } from '../config/schema.js';
import { redactHeaders, redactUrl } from './redact.js';
import type { ConsoleMessageLike, DiagnosticsPageLike, RequestLike, ResponseLike } from './page-events.js';

/**
 * Legacy scaffold retained verbatim so the pre-existing
 * `tests/visual/homepage.spec.ts` (untouched legacy file) keeps compiling
 * and running unchanged. Superseded for new code by
 * `createDiagnosticsCollector` below, which is the SPEC-005 implementation.
 */
export function collectDiagnostics(page: Page, testInfo: TestInfo): void {
  page.on('console', async message => {
    if (message.type() === 'error') await testInfo.attach('console-error', { body: Buffer.from(message.text()), contentType: 'text/plain' });
  });
  page.on('pageerror', async error => {
    await testInfo.attach('page-error', { body: Buffer.from(error.stack ?? error.message), contentType: 'text/plain' });
  });
  page.on('requestfailed', async request => {
    const body = `${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'Unknown error'}`;
    await testInfo.attach('failed-request', { body: Buffer.from(body), contentType: 'text/plain' });
  });
}

export interface ConsoleEntry {
  type: string;
  text: string;
}

export interface PageErrorEntry {
  message: string;
  stack?: string;
}

export interface RequestEntry {
  url: string;
  method: string;
  status?: number;
  failure?: string;
  headers: Record<string, string>;
}

export interface DiagnosticsSnapshot {
  console: ConsoleEntry[];
  pageErrors: PageErrorEntry[];
  requests: RequestEntry[];
}

export interface DiagnosticsCollector {
  snapshot(): DiagnosticsSnapshot;
}

/**
 * Extracts the lowercased host of a URL, or `null` when the URL cannot be
 * parsed. Used only for `ignoredDomains` matching against the ORIGINAL
 * (pre-redaction) url — never throws.
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when `host` equals or is a subdomain of one of `ignoredDomains`
 * (case-insensitive). `ignoredDomains` entries are compared verbatim
 * (lowercased); a `null` host (unparseable url) never matches.
 */
function isIgnoredHost(host: string | null, ignoredDomains: readonly string[]): boolean {
  if (host === null) return false;
  return ignoredDomains.some(domain => {
    const normalized = domain.toLowerCase();
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

function deepCopySnapshot(snapshot: DiagnosticsSnapshot): DiagnosticsSnapshot {
  return {
    console: snapshot.console.map(entry => ({ ...entry })),
    pageErrors: snapshot.pageErrors.map(entry => ({ ...entry })),
    requests: snapshot.requests.map(entry => ({ ...entry, headers: { ...entry.headers } }))
  };
}

/**
 * Creates a diagnostics collector attached to `page`. Listeners are
 * registered immediately (on construction) and accumulate entries in
 * insertion order for the lifetime of the collector. `snapshot()` always
 * returns a deep copy so later mutation of either side cannot affect the
 * other.
 */
export function createDiagnosticsCollector(
  page: DiagnosticsPageLike,
  policy: DiagnosticsPolicy
): DiagnosticsCollector {
  const consoleEntries: ConsoleEntry[] = [];
  const pageErrorEntries: PageErrorEntry[] = [];
  const requestEntries: RequestEntry[] = [];

  if (policy.captureConsole) {
    page.on('console', (msg: ConsoleMessageLike) => {
      consoleEntries.push({ type: msg.type(), text: msg.text() });
    });
  }

  page.on('pageerror', (error: Error) => {
    const entry: PageErrorEntry = { message: error.message };
    if (error.stack !== undefined) entry.stack = error.stack;
    pageErrorEntries.push(entry);
  });

  if (policy.captureNetwork) {
    page.on('requestfailed', (request: RequestLike) => {
      if (isIgnoredHost(hostOf(request.url()), policy.ignoredDomains)) return;
      const entry: RequestEntry = {
        url: redactUrl(request.url()),
        method: request.method(),
        headers: redactHeaders(request.headers())
      };
      const errorText = request.failure()?.errorText;
      if (errorText !== undefined) entry.failure = errorText;
      requestEntries.push(entry);
    });

    page.on('response', (response: ResponseLike) => {
      if (response.status() < 400) return;
      const request = response.request();
      if (isIgnoredHost(hostOf(response.url()), policy.ignoredDomains)) return;
      requestEntries.push({
        url: redactUrl(response.url()),
        method: request.method(),
        status: response.status(),
        headers: redactHeaders(response.headers())
      });
    });
  }

  return {
    snapshot(): DiagnosticsSnapshot {
      return deepCopySnapshot({
        console: consoleEntries,
        pageErrors: pageErrorEntries,
        requests: requestEntries
      });
    }
  };
}
