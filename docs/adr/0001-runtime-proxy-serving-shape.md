# Serve third-party scripts through a runtime proxy, not a pinned copy

**Status:** Accepted (2026-08-30; the React Router prototype, ticket 14, confirmed the shape; tickets 17 and 18 closed)
**Date:** 2026-08-29, amended 2026-08-30
**Authors:** jbaz
**Source:** wayfinder ticket 16, `.scratch/secondparty-design/issues/16-serving-shape.md`

## Context

Lighthouse's "Use efficient cache lifetimes" insight flags every third-party script
with a cache lifetime under 30 days. On one live Shopify storefront (audit 2026-08-29) that is 452 KiB across Meta,
Yotpo, Rise.ai, Clarity, Klaviyo, and others. We cannot set `Cache-Control` on a
vendor's origin. The only fix is to serve those bytes from our own origin with our own
headers.

Our first design copied vendor bytes at build time into the repo, pinned them with a
lock file, and served them as hashed static assets. Vendor-terms research on 2026-08-29
changed that. Meta, Google, Klaviyo, Yotpo, Contentsquare (Hotjar), TikTok, and Clarity
all carry "no copy, no modify, no distribute" clauses (Clarity and TikTok quotes come
from search-index text; their pages are login-gated and unverified in a browser). No
vendor names self-hosting. The
one sanctioned first-party path is Google's tag gateway, and it is a live proxy on the
site's domain, not a stored copy. Vimeo is the exception: `@vimeo/player` is MIT on npm.

Evidence: `.scratch/secondparty-design/research/00-chrome-cache-insight.md`,
`01-chain-shape-audit.md`, `03-vendor-terms.md`, `04-origin-sensitivity.md`.

## Exploration

**Pinned build-time copy.** Fetch at build, commit bytes and a lock, emit hashed files.
Reproducible and offline. Rejected: it stores and redistributes vendor code, the shape
with the most terms exposure. It also needs a headless-browser discovery step to find
chained loads, and a CI job to catch drift.

**Runtime proxy, stable path, 30-day TTL.** A route on our origin fetches vendor bytes
and serves `/__sp/klaviyo.js` with `max-age=2592000`. Lighthouse is clean. Rejected:
the URL has no hash, so a returning visitor runs up to 30-day-old vendor code with no
way to bust it. Worse drift than a pinned copy.

**Runtime proxy, short TTL with stale-while-revalidate.** Fresh, simple. Rejected:
Lighthouse still flags it. It does not solve the problem.

**Standalone edge Worker in front of the app.** No framework code. Rejected as the only
shape: it cannot compute a hash at render time, and it couples to Cloudflare-style
deploys.

**Runtime proxy, content-hashed path computed at render.** Chosen. See Decision.

## Decision

We serve third-party scripts through a runtime proxy on the app origin. Nothing
vendor-owned lives in the repo.

- The core exports `handle(request: Request, ctx: { cache: CacheLike }): Promise<Response>`;
  the handler needs the cache to read the record (ticket 14). Each framework mounts
  it at a path prefix with a thin adapter: a React Router 7 resource route, an Astro
  endpoint, a Nuxt server route, a Next.js route handler, or a bare Worker.
- Each entry is a key and a vendor URL in `secondparty.config.server.ts`. That file
  exports one typed server function per key (ADR 0002; no bundler plugin, no
  `secondparty:<key>` specifier). Called in a loader or server component, it fetches
  the vendor bytes through a cache, hashes them, and returns
  `{ url: '/__sp/<key>.<hash>.<ext>' }`.
- The hash is SHA-256 over the decoded bytes, hex, 16 chars. The extension comes from
  a Content-Type map, then from the vendor URL. The handler parses only the last path
  segment; `prefix` (default `/__sp/`) is config for URL building. (Ticket 07.)
- The proxy serves that URL with `Cache-Control: public, max-age=31536000,
  s-maxage=31536000, immutable`, `ETag: "<hash>"`, `Vary: Accept-Encoding`,
  `X-Content-Type-Options: nosniff`, `Access-Control-Allow-Origin: *`, and answers
  `If-None-Match` with 304. Bodies go out identity-encoded; the platform compresses.
  Lighthouse sees a 1-year lifetime. `s-maxage` is what Vercel's CDN needs; Oxygen
  needs a user-added `Oxygen-Cache-Control` in the route; Cloudflare never CDN-caches a
  Worker response, so the Cache API record is the shared cache there. No headers file
  ships. (Tickets 07, 11.)
- The core takes a Web `Cache` (`match`/`put`), passed explicitly to each entry
  function. Its declared type is a structural `CacheLike` (ticket 13). Workers, Oxygen,
  and Netlify Edge pass `await caches.open('secondparty')`.
  Node uses the one adapter we ship: an in-memory Web `Cache`. No `createWithCache`
  adapter: it stores JSON only, and it wraps the same Cache API. (Ticket 05.)
- The core owns freshness. Each entry has a fixed `ttl` (default 1 hour). Vendor
  `Cache-Control` is ignored: observed values span 0 s to 1 year, some are absent, and
  platform caches drop `stale-while-revalidate`/`stale-if-error`. A stale entry blocks
  the render until revalidated; revalidation uses `If-None-Match` when the vendor sent
  an ETag. (Ticket 05.)
- Retention is `staleTtl` (default 7 days). Inside it, vendor error serves stale.
  Outside it, 502.
- The proxy forwards nothing from the visitor (no cookies, language, origin, referer)
  and sends `User-Agent: secondparty/<version>`. One body per entry. A fetch matrix
  over 8 vendor URLs showed byte-identical bodies across those headers.
- Bodies are verbatim. We never rewrite vendor code.
- Vendor error (timeout 5 s default, network failure, non-2xx, Content-Type outside
  the ext map): serve stale from the cache within `staleTtl`. With no usable record the
  handler answers 502 and never redirects to the vendor; the entry function returns
  `{ url: <vendor url>, degraded: true }` so the page renders. A 30 s negative record
  stops retry storms; it stores the error `code`, so the 502 and the `degraded` event
  inside the window name the real fault (tickets 12, 14).
- A request for an old hash after rotation gets the key's current bytes with
  `max-age=<ttl>` and no `immutable`. We keep no history. (Ticket 07.)
- Single flight: one in-flight vendor fetch per key per process, in memory. Calls that
  arrive during it, from the render or the handler site, wait for its outcome. The map
  is per config, never per cache object, because `caches.open()` returns a new object
  per call on workerd. No knob; no `waitUntil`, no SWR in v1. (Ticket 18.)
- Observability is headers plus one hook. The handler adds `X-SecondParty-Key`,
  `-Fetched-At`, `-Source`, `-Vendor-Cache-Control` (when stored), and `-Stale: 1` on a
  stale serve. The config takes an optional global `onEvent` that receives `hit`, `fetch`,
  `stale`, `degraded`, or `error` events with `key` and `site`; without it the core
  `console.warn`s on `error` and `degraded`. Hook faults are swallowed. No CLI, no log
  schema. (Ticket 10.)

Example, Klaviyo in React Router 7:

```ts
import { entries } from '~/secondparty.config.server'

export async function loader({ context }: Route.LoaderArgs) {
  const { url } = await entries.klaviyo({ cache: context.cache })
  return { klaviyoUrl: url }
}
```

Out of scope for v1: static-only hosts (no runtime), pinned build-time copies, body
rewriting, chained loads that a vendor loader hardcodes to its own CDN.

## Consequences

- Freshness is bounded by `ttl` (default 1 hour), not by deploys. The old tagline
  "zero drift" was dropped for that reason (ticket 15); the README states the bound.
- Caches are per data center on the edge and per process on Node. Two locations may
  serve different hashes for one entry within a `ttl`; the old-hash rule makes any
  hash serve current bytes.
- Vercel Edge runtime has no Cache API and is unsupported. Vercel Node functions work.
- Builds are not reproducible for vendor bytes. Prod serves what the vendor served at
  last revalidation.
- Static-only sites cannot use v1. They keep the Lighthouse flag.
- Client-only code cannot call the entry function. The URL arrives as loader or
  server-component data.
- A cache miss adds a vendor fetch to a render. Each process or isolate pays this once
  per entry; concurrent renders inside one process share the fetch (ticket 18). A
  Node cluster with P processes takes P cold fetches per key.
- Klaviyo, Meta `fbevents.js`, the Yotpo loader, and Vimeo `player.js` execute from the
  proxied URL (ticket 14; the audit misread the Klaviyo and Meta checks). Awin loads
  from the proxied URL with no error but never tracks: its `getScriptUrl()` scans script
  tags for the literal `/awin-shopify-integration-code.js` and skips `run()` on no match
  (ticket 17). The README says "do not proxy Awin" and "test vendors for effect, not for
  absence of errors". We document these, we do not patch them.
- Loader scripts that hardcode chained loads to the vendor CDN (Yotpo loader, Meta
  config) keep those nodes flagged.
- Terms exposure drops but does not vanish. The README says "check vendor terms" and
  names the sanctioned cases: Google tag gateway, Vimeo on npm.
- Removed from the plan: lock file, discovery browser, CI drift PRs, bundler emit hooks.

## Implementation

React Router 8 on Workers: the default server entry picks `renderToPipeableStream` when
`@react-router/node` is installed and throws on workerd; ship one `app/entry.server.tsx`
copied from the web default, and return a `RouterContextProvider` from `getLoadContext`
(ticket 14).

Closed: cache interface and revalidation (05); config file vs virtual module (09, ADR 0002);
hash and path scheme (07); config surface (06); types (13); failure policy (12); serving headers (11); chained-node limitation (08); observability (10); prototype (14, PASS on Node and
workerd); Awin (17); single flight (18); test environment (19). Open: README limitations (15),
a wayfinder ticket under `.scratch/secondparty-design/issues/`.

The prototype (14) showed that Klaviyo and Meta run from `/__sp/` without path mimicry;
ticket 08 stays closed.
