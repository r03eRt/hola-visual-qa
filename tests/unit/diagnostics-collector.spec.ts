import { test, expect } from '@playwright/test';
import type { DiagnosticsPolicy } from '../../src/config/schema.js';
import {
  createDiagnosticsCollector,
  redactHeaders,
  redactUrl,
  type ConsoleMessageLike,
  type DiagnosticsPageEvent,
  type DiagnosticsPageLike,
  type RequestLike,
  type ResponseLike
} from '../../src/diagnostics/index.js';

function policy(overrides: Partial<DiagnosticsPolicy> = {}): DiagnosticsPolicy {
  return { captureConsole: true, captureNetwork: true, ignoredDomains: [], ...overrides };
}

function consoleMessage(type: string, text: string): ConsoleMessageLike {
  return { type: () => type, text: () => text };
}

function request(
  url: string,
  method: string,
  headers: Record<string, string> = {},
  failure: { errorText: string } | null = null
): RequestLike {
  return {
    url: () => url,
    method: () => method,
    failure: () => failure,
    headers: () => headers
  };
}

function response(url: string, status: number, req: RequestLike, headers: Record<string, string> = {}): ResponseLike {
  return {
    url: () => url,
    status: () => status,
    request: () => req,
    headers: () => headers
  };
}

/** Hermetic fake `DiagnosticsPageLike`: records registered handlers so tests can drive synthetic events. */
class FakeDiagnosticsPage implements DiagnosticsPageLike {
  private handlers: Partial<Record<DiagnosticsPageEvent, ((...args: never[]) => void)[]>> = {};

  on(event: 'console', handler: (msg: ConsoleMessageLike) => void): void;
  on(event: 'pageerror', handler: (error: Error) => void): void;
  on(event: 'requestfailed', handler: (request: RequestLike) => void): void;
  on(event: 'response', handler: (response: ResponseLike) => void): void;
  on(event: DiagnosticsPageEvent, handler: (...args: never[]) => void): void {
    (this.handlers[event] ??= []).push(handler);
  }

  emit(event: 'console', msg: ConsoleMessageLike): void;
  emit(event: 'pageerror', error: Error): void;
  emit(event: 'requestfailed', request: RequestLike): void;
  emit(event: 'response', response: ResponseLike): void;
  emit(event: DiagnosticsPageEvent, payload: ConsoleMessageLike | Error | RequestLike | ResponseLike): void {
    for (const handler of this.handlers[event] ?? []) handler(payload as never);
  }
}

test.describe('redactHeaders', () => {
  test('drops sensitive headers case-insensitively and preserves the rest', () => {
    const headers = {
      Authorization: 'Bearer secret-token',
      'X-Api-Key': 'abc123',
      COOKIE: 'session=xyz',
      'Set-Cookie': 'session=xyz; Path=/',
      'proxy-authorization': 'Basic zzz',
      'api-key': 'k1',
      'X-Auth-Token': 't1',
      Authentication: 'a1',
      'Content-Type': 'application/json',
      'X-Request-Id': 'req-1'
    };
    const redacted = redactHeaders(headers);
    expect(redacted).toEqual({ 'Content-Type': 'application/json', 'X-Request-Id': 'req-1' });
  });

  test('preserves key order of the remaining headers', () => {
    const redacted = redactHeaders({ b: '2', authorization: 'x', a: '1' });
    expect(Object.keys(redacted)).toEqual(['b', 'a']);
  });

  test('leaves an already-clean headers object untouched', () => {
    const headers = { 'x-request-id': '1', accept: 'text/html' };
    expect(redactHeaders(headers)).toEqual(headers);
  });
});

test.describe('redactUrl', () => {
  test('strips query string and fragment, keeping origin + pathname', () => {
    expect(redactUrl('https://example.com/api/data?token=secret&x=1#frag')).toBe('https://example.com/api/data');
  });

  test('returns the url unchanged when there is no query/fragment', () => {
    expect(redactUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  test('falls back to substring before ? or # when unparseable', () => {
    expect(redactUrl('not a url?token=secret')).toBe('not a url');
    expect(redactUrl('not a url#frag')).toBe('not a url');
  });

  test('never throws on garbage input', () => {
    expect(() => redactUrl('')).not.toThrow();
    expect(() => redactUrl('::::')).not.toThrow();
  });
});

test.describe('createDiagnosticsCollector', () => {
  test('captures a console message, page error, failed request and non-success response', () => {
    const page = new FakeDiagnosticsPage();
    const collector = createDiagnosticsCollector(page, policy());

    page.emit('console', consoleMessage('log', 'hello world'));
    page.emit('pageerror', new Error('boom'));
    page.emit('requestfailed', request('https://example.com/fail', 'GET', {}, { errorText: 'net::ERR_FAILED' }));
    page.emit('response', response('https://example.com/api', 500, request('https://example.com/api', 'GET')));

    const snapshot = collector.snapshot();
    expect(snapshot.console).toEqual([{ type: 'log', text: 'hello world' }]);
    expect(snapshot.pageErrors).toHaveLength(1);
    expect(snapshot.pageErrors[0]?.message).toBe('boom');
    expect(snapshot.requests).toEqual([
      { url: 'https://example.com/fail', method: 'GET', failure: 'net::ERR_FAILED', headers: {} },
      { url: 'https://example.com/api', method: 'GET', status: 500, headers: {} }
    ]);
  });

  test('ignores non-success responses below 400', () => {
    const page = new FakeDiagnosticsPage();
    const collector = createDiagnosticsCollector(page, policy());

    page.emit('response', response('https://example.com/ok', 200, request('https://example.com/ok', 'GET')));
    page.emit('response', response('https://example.com/redir', 302, request('https://example.com/redir', 'GET')));

    expect(collector.snapshot().requests).toEqual([]);
  });

  test('captureConsole:false suppresses console entries', () => {
    const page = new FakeDiagnosticsPage();
    const collector = createDiagnosticsCollector(page, policy({ captureConsole: false }));

    page.emit('console', consoleMessage('error', 'should not be captured'));

    expect(collector.snapshot().console).toEqual([]);
  });

  test('captureNetwork:false suppresses request and response entries', () => {
    const page = new FakeDiagnosticsPage();
    const collector = createDiagnosticsCollector(page, policy({ captureNetwork: false }));

    page.emit('requestfailed', request('https://example.com/fail', 'GET', {}, { errorText: 'net::ERR_FAILED' }));
    page.emit('response', response('https://example.com/api', 500, request('https://example.com/api', 'GET')));

    expect(collector.snapshot().requests).toEqual([]);
  });

  test('page errors are always captured regardless of policy', () => {
    const page = new FakeDiagnosticsPage();
    const collector = createDiagnosticsCollector(page, policy({ captureConsole: false, captureNetwork: false }));

    page.emit('pageerror', new Error('always captured'));

    const pageErrors = collector.snapshot().pageErrors;
    expect(pageErrors).toHaveLength(1);
    expect(pageErrors[0]?.message).toBe('always captured');
  });

  test('ignoredDomains drops matching host and subdomain requests/responses, and nothing else', () => {
    const page = new FakeDiagnosticsPage();
    const collector = createDiagnosticsCollector(page, policy({ ignoredDomains: ['example.com'] }));

    page.emit('requestfailed', request('https://example.com/tracker', 'GET', {}, { errorText: 'blocked' }));
    page.emit('requestfailed', request('https://ads.example.com/pixel', 'GET', {}, { errorText: 'blocked' }));
    page.emit('requestfailed', request('https://notexample.com/keep', 'GET', {}, { errorText: 'blocked' }));
    page.emit('response', response('https://example.com/api', 500, request('https://example.com/api', 'GET')));
    page.emit('response', response('https://keep.dev/api', 500, request('https://keep.dev/api', 'GET')));

    const urls = collector.snapshot().requests.map(entry => entry.url);
    expect(urls).toEqual(['https://notexample.com/keep', 'https://keep.dev/api']);
  });

  test('no stored header contains authorization/cookie/set-cookie, case-insensitively', () => {
    const page = new FakeDiagnosticsPage();
    const collector = createDiagnosticsCollector(page, policy());

    page.emit(
      'requestfailed',
      request(
        'https://example.com/fail',
        'GET',
        { Authorization: 'Bearer secret', Cookie: 'session=abc', 'X-Keep': '1' },
        { errorText: 'net::ERR_FAILED' }
      )
    );
    page.emit(
      'response',
      response('https://example.com/api', 500, request('https://example.com/api', 'GET'), {
        'set-cookie': 'session=abc; Path=/',
        'x-keep': '2'
      })
    );

    for (const entry of collector.snapshot().requests) {
      const keys = Object.keys(entry.headers).map(key => key.toLowerCase());
      expect(keys).not.toContain('authorization');
      expect(keys).not.toContain('cookie');
      expect(keys).not.toContain('set-cookie');
    }
  });

  test('no stored url contains a query string', () => {
    const page = new FakeDiagnosticsPage();
    const collector = createDiagnosticsCollector(page, policy());

    page.emit(
      'requestfailed',
      request('https://example.com/fail?token=secret', 'GET', {}, { errorText: 'net::ERR_FAILED' })
    );
    page.emit(
      'response',
      response('https://example.com/api?session=abc', 500, request('https://example.com/api?session=abc', 'GET'))
    );

    for (const entry of collector.snapshot().requests) {
      expect(entry.url).not.toContain('?');
    }
  });

  test('snapshot is deterministic for the same event sequence', () => {
    const buildSnapshot = () => {
      const page = new FakeDiagnosticsPage();
      const collector = createDiagnosticsCollector(page, policy());
      page.emit('console', consoleMessage('log', 'a'));
      page.emit('requestfailed', request('https://example.com/x', 'GET', {}, { errorText: 'c' }));
      return collector.snapshot();
    };

    const first = buildSnapshot();
    const second = buildSnapshot();
    expect(second).toEqual(first);
  });

  test('snapshot is a deep copy isolated from later mutation and later events', () => {
    const page = new FakeDiagnosticsPage();
    const collector = createDiagnosticsCollector(page, policy());

    page.emit('console', consoleMessage('log', 'first'));
    const first = collector.snapshot();

    // Mutating the returned snapshot must not affect a later snapshot.
    first.console.push({ type: 'log', text: 'mutated' });
    first.requests.push({ url: 'https://mutated.example', method: 'GET', headers: {} });

    // New events after the first snapshot must not affect the earlier snapshot.
    page.emit('console', consoleMessage('log', 'second'));

    const second = collector.snapshot();
    expect(first.console).toEqual([{ type: 'log', text: 'first' }, { type: 'log', text: 'mutated' }]);
    expect(second.console).toEqual([{ type: 'log', text: 'first' }, { type: 'log', text: 'second' }]);
  });
});
