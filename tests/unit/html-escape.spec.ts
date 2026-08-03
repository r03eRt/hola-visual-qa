import { test, expect } from '@playwright/test';
import { escapeHtml, escapeAttribute } from '../../src/reporting/html/escape.js';

test.describe('escapeHtml', () => {
  test('escapes & first so subsequent replacements do not double-escape', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  test('escapes <, >, ", and \'', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  test('escapes all five entities together in the documented order', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('leaves already-safe text unchanged', () => {
    expect(escapeHtml('plain text 123 with spaces')).toBe('plain text 123 with spaces');
  });

  test('escapes a full script injection attempt', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

test.describe('escapeAttribute', () => {
  test('applies the same escaping rules as escapeHtml', () => {
    expect(escapeAttribute(`&<>"'`)).toBe(escapeHtml(`&<>"'`));
  });

  test('escapes a relative artifact path safely', () => {
    expect(escapeAttribute('artifacts/"onerror=alert(1)/expected.png')).toBe(
      'artifacts/&quot;onerror=alert(1)/expected.png'
    );
  });
});
