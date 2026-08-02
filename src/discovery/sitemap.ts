/**
 * Pure sitemap XML parsing. See
 * docs/features/url-sitemap-discovery/SPEC.md. Tolerant of namespaces,
 * whitespace and CDATA; never throws — malformed/empty input yields `[]`.
 */

const LOC_PATTERN =
  /<(?:\w+:)?loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/(?:\w+:)?loc>/gi;

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'"
};

function unescapeXmlEntities(value: string): string {
  return value.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (match) => XML_ENTITIES[match] ?? match);
}

/**
 * Extracts the text of every `<loc>` element from a sitemap XML document,
 * regardless of namespace prefix, tolerant of surrounding whitespace and
 * `<![CDATA[...]]>` wrapping. Never throws; returns `[]` for empty,
 * garbage or non-string-ish input.
 */
export function parseSitemapLocations(xml: string): string[] {
  if (typeof xml !== 'string' || xml.length === 0) {
    return [];
  }

  const locations: string[] = [];
  try {
    for (const match of xml.matchAll(LOC_PATTERN)) {
      const raw = match[1];
      if (typeof raw !== 'string') continue;
      const trimmed = unescapeXmlEntities(raw.trim());
      if (trimmed.length > 0) {
        locations.push(trimmed);
      }
    }
  } catch {
    return [];
  }

  return locations;
}
