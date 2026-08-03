import { escapeHtml } from '../reporting/html/escape.js';

/**
 * Static local-dashboard shell page (SPEC-011 / local-dashboard-shell). PURE:
 * one self-contained `<!doctype html>` document, inline `<style>` only, no
 * `<script>` and no external/CDN assets — mirrors the audited HTML report
 * pattern in `src/reporting/html/render.ts`. Run execution and report viewing
 * are not yet wired up; the page says so explicitly.
 */

const TITLE = 'Local Visual QA dashboard';
const NOT_YET_AVAILABLE_NOTE =
  'Run execution and report viewing are not yet available in this dashboard.';

const STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; background: #f7f7f9; color: #1c1c1e; }
  h1 { margin-top: 0; }
  .notice { background: #fff8e1; border: 1px solid #f2c94c; border-radius: 8px; padding: 16px 20px; }
`;

export function renderShellPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(TITLE)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${escapeHtml(TITLE)}</h1>
<p class="notice">${escapeHtml(NOT_YET_AVAILABLE_NOTE)}</p>
</body>
</html>
`;
}
