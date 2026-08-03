import { escapeHtml } from '../reporting/html/escape.js';

/**
 * Static local-dashboard shell page (SPEC-011 / local-dashboard-shell, updated
 * by docs/features/dashboard-shell-navigation/SPEC.md). PURE: one self-contained
 * `<!doctype html>` document, inline `<style>` only, no `<script>` and no
 * external/CDN assets — mirrors the audited HTML report pattern in
 * `src/reporting/html/render.ts`. It is the loopback landing page and links to
 * the read-only report viewer (#32); it never executes anything itself.
 */

const TITLE = 'Local Visual QA dashboard';
const INTRO =
  'Local-first visual QA. Deterministic Playwright runs, results persisted to disk, ' +
  'and a read-only report viewer — all bound to loopback.';
const RUN_NOTE =
  'Launch a run by sending POST /api/runs (optionally with a subset of planned scenario ids). ' +
  'This page executes nothing on its own.';

const STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; background: #f7f7f9; color: #1c1c1e; }
  h1 { margin-top: 0; }
  a { color: #1d4ed8; }
  nav a { display: inline-block; margin-right: 16px; font-weight: 600; }
  .note { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 12px 16px; margin-top: 16px; }
  code { background: #f0f0f2; border-radius: 4px; padding: 1px 4px; }
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
<p>${escapeHtml(INTRO)}</p>
<nav>
<a href="/app">Open the visual app</a>
<a href="/runs">View reports</a>
<a href="/healthz">Health</a>
</nav>
<p class="note">${escapeHtml(RUN_NOTE)}</p>
</body>
</html>
`;
}
