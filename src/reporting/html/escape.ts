/**
 * Single audited HTML-escaping primitive (SPEC-009 / custom-html-report).
 * Every dynamic string interpolated into the rendered report MUST pass
 * through one of these two functions. `&` is replaced FIRST so subsequent
 * replacements never double-escape an entity produced by an earlier step.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Same escaping rules; used for values placed inside href/src attributes. */
export function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
