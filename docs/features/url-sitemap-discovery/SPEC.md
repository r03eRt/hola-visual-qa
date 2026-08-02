# Feature SPEC — url-sitemap-discovery

- Roadmap item: 24
- Issue: #51
- Canonical spec: `docs/specs/SPEC-010-URL-INVENTORY.md`
- Type: `feature` + `security` (touches host allowlisting)
- Branch: `feature/url-sitemap-discovery`

## Summary

Add a deterministic, dependency-injected capability that turns a **sitemap
document** into a normalized, deduplicated, host-allowlisted, route-filtered,
size-limited **URL inventory**. This is the additive discovery primitive that
SPEC-010 describes as the successor to explicit page configuration. It is
**not** a crawler (SPEC-010 defers that to a separate PR) and performs **no
network or filesystem I/O itself** — fetching is injected so unit tests are
100% hermetic.

## Motivation

MVP URLs are explicit config entries. SPEC-010 requires a discovery path that
stays within allowed hosts, normalizes and deduplicates URLs, ignores
logout/destructive/account-action routes, applies maximum limits, and supports
persisting the resolved inventory in the run manifest. This PR delivers that
primitive without wiring it into a live run (a later ticket).

## Scope (this PR)

1. New module `src/discovery/`:
   - `contract.ts` — types: `DiscoveredPage` (`{ path, url }`), `UrlInventory`
     (Zod, `.strict()`, secret-key-guarded), `DiscoveryOptions`
     (`{ allowedHosts, baseUrl?, maxUrls, ignorePathPatterns? }`),
     `DiscoveryOutcome` (result + counters), and the `SitemapFetcher` DI port
     (`{ fetch(url: string): Promise<string> }`).
   - `sitemap.ts` — pure `parseSitemapLocations(xml): string[]` extracting every
     `<loc>` (tolerant of namespaces/whitespace/CDATA; tolerant of malformed
     input — returns what it can, never throws).
   - `normalize.ts` — pure `normalizeUrl(raw, baseUrl?): NormalizedUrl | null`
     returning `{ url, host, path }` where `url` is `origin + path` (host
     lowercased, query + fragment stripped, duplicate slashes collapsed,
     trailing slash removed except root). Returns `null` for unparseable input.
   - `ignore.ts` — `DEFAULT_IGNORED_PATH_PATTERNS: RegExp[]` (logout, sign-out,
     account, profile delete, delete/remove, unsubscribe, admin, password/reset,
     checkout, cart, order) and `isIgnoredPath(path, extraPatterns?): boolean`.
   - `discover.ts` — pure `discoverFromSitemap(xml, options): DiscoveryOutcome`
     (parse → normalize → drop out-of-host → drop ignored routes → dedupe →
     deterministic sort by url → cap at `maxUrls`); and
     `discoverUrls(fetcher, sitemapUrl, options): Promise<DiscoveryOutcome>`
     (awaits injected fetch then calls the pure function).
   - `index.ts` — barrel.
2. Config: **optional** `discovery` policy on `ProjectConfig`
   (`DiscoveryPolicySchema`, `.strict()`): `sitemapUrl?: string(url)`,
   `maxUrls: number int >=1 (default 200)`, `ignorePathPatterns: string[]
   (default [])` — regex source strings appended to the defaults. It is
   `.optional()` (no prefault) so **existing configs and typed literals are
   unaffected**.
3. Manifest: **optional** `inventory` field on `RunManifestSchema`
   (`UrlInventorySchema.optional()`) and `buildRunManifest` support (optional
   `inventory` input, included only when provided) — **optional so existing
   manifests stay valid** and no existing manifest literal needs changes.

## Security requirements

- **Host allowlisting is mandatory and is the primary guard**: any URL whose
  normalized host is not present in `allowedHosts` (case-insensitive exact
  match) is dropped and counted in `outOfHostCount`. Empty/whitespace hosts are
  dropped.
- Normalization **strips query and fragment** so tokens/secrets in sitemap URLs
  never enter the inventory or the manifest.
- Ignore-route filtering drops logout/destructive/account-action paths.
- `UrlInventorySchema` is `.strict()` and secret-key-guarded (its own
  `rejectSecretLikeKeys`-style refine) so it can be safely embedded in the
  manifest.

## Acceptance criteria

- [x] `parseSitemapLocations` extracts all `<loc>` values from valid sitemap
      XML (with/without namespace, extra whitespace, CDATA) and returns `[]` for
      empty/garbage input without throwing.
- [x] `normalizeUrl` lowercases host, strips query+fragment, collapses `//`,
      removes trailing slash (except root), and returns `null` for unparseable
      input.
- [x] `discoverFromSitemap` produces an inventory that: contains only
      allowed-host URLs; contains no ignored routes; has no duplicates; is
      sorted deterministically; and is capped at `maxUrls`. Every drop is
      reflected in the counters (`totalFound`, `outOfHostCount`, `ignoredCount`,
      `duplicateCount`, `truncatedCount`, `keptCount`).
- [x] `discoverUrls` uses the injected `SitemapFetcher` and performs no real
      I/O in tests.
- [x] `DiscoveryPolicySchema` parses `{}` to defaults; is `.strict()`;
      `ProjectConfig` remains valid when `discovery` is omitted.
- [x] `RunManifestSchema` accepts a manifest **with** and **without**
      `inventory`; `buildRunManifest` includes `inventory` only when provided;
      all existing manifest tests still pass unchanged.
- [x] All unit tests hermetic (no network, no browser fixture); `npm run
      typecheck`, `npm run lint`, `npm run test:unit` green.

## Non-goals

- A crawler or recursive sitemap-index following beyond a single flat document.
- The real network/filesystem `SitemapFetcher` implementation.
- Wiring discovery into the planner/orchestrator or auto-populating the manifest
  during a live run.
- Changing existing config or manifest literals.

## Definition of done

Acceptance criteria pass with tests; `docs/STATUS.md` and this SPEC reflect
reality (capability = implemented, wiring = not implemented); security
implications (host allowlisting, query stripping) reviewed; PR stays within
scope.
