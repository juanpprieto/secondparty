# secondparty v1: API guide and replication target

**Status:** Hand-off spec for `writing-plans`. Ticket 15 (README) closed 2026-08-30; its answer holds the README outline and limitation text. Derived from ADR 0001 and ADR 0002 (both Accepted 2026-08-30). Ticket 14 (2026-08-30)
passed all 14 Validation rows on Node and rows 1 to 10 and 14 on `wrangler dev`; evidence in
`.scratch/prototype-14/RESULTS.md`. Tickets 17 (Awin) and 18 (concurrent cold renders) closed
2026-08-30; ADR 0001 amended and both ADRs Accepted the same day. Amendments are marked "(ticket N)".
**Date:** 2026-08-29, amended 2026-08-30
**Sources:** `docs/adr/0001-runtime-proxy-serving-shape.md`, `docs/adr/0002-config-object-not-virtual-module.md`,
`CONTEXT.md`, wayfinder tickets 05, 06, 07, 10, 11, 12, 13 under `.scratch/secondparty-design/issues/`.

## Overview

`secondparty` serves third-party scripts, styles, and fonts from the app origin through a
runtime proxy. Each entry gets a content-hashed asset path with a one-year cache lifetime.
Lighthouse's "Use efficient cache lifetimes" insight stops flagging those assets. The
package ships no bundler plugin, no CLI, no headers file, and stores no vendor bytes in
the repo.

## Public API

```ts
// Runtime exports
export function defineSecondparty<const T extends Record<string, Entry>>(
  options: SecondpartyOptions<T>,
): { entries: Entries<T>; handle: (request: Request, ctx: EntryContext) => Promise<Response> }  // ctx added (ticket 14)
export class SecondpartyError extends Error {
  code: 'timeout' | 'status' | 'content_type' | 'network'
  key: string
  status?: number
  cause?: unknown
}
export function createMemoryCache(): CacheLike   // the one Node adapter; name settled (ticket 14)

// Types (eight public)
export type Entry = { url: string; ttl?: number; staleTtl?: number; timeout?: number }
export type SecondpartyOptions<T> = {
  entries: T & { [K in keyof T]: Exact<T[K], Entry> }   // Exact is internal
  ttl?: number        // seconds, default 3600
  staleTtl?: number   // seconds, default 604800
  timeout?: number    // seconds, fractions allowed (ticket 19), default 5
  prefix?: string     // default '/__sp/'
  userAgent?: string  // default `secondparty/<version>`
  onEvent?: (event: SecondpartyEvent) => void
}
export type CacheLike = {
  match(request: Request | string): Promise<Response | undefined>
  put(request: Request | string, response: Response): Promise<void>
}
export type EntryContext = { cache: CacheLike }
export type EntryResult = { url: string; degraded: boolean }
export type EntryFunction = (ctx: EntryContext) => Promise<EntryResult>
export type Entries<T> = { readonly [K in keyof T]: EntryFunction }
export type SecondpartyEvent = { key: string; site: 'render' | 'handler' } & (
  | { type: 'hit'; hash: string; fetchedAt: string }
  | { type: 'fetch'; hash: string; fetchedAt: string; status: 200 | 304; durationMs: number }
  | { type: 'stale'; hash: string; fetchedAt: string }
  | { type: 'degraded'; error: SecondpartyError }
  | { type: 'error'; error: SecondpartyError }
)
```

`defineSecondparty` throws one `Error` at module load that lists every failed check:
key charset `[A-Za-z0-9_-]+`; `url` parses as `http:` or `https:`; `ttl > 0`;
`staleTtl >= ttl` after the per-entry merge; `timeout > 0`; `prefix` starts with `/`.
It also throws when `typeof document !== 'undefined'` (client import guard).

## Consumer code: React Router 7 on Node

`app/secondparty.config.server.ts`

```ts
import { defineSecondparty } from 'secondparty'

export const { entries, handle } = defineSecondparty({
  entries: {
    klaviyo: { url: 'https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=XXXX' },
    yotpo: { url: 'https://cdn-widgetsrepository.yotpo.com/v1/loader/XXXX' },
    fbevents: { url: 'https://connect.facebook.net/en_US/fbevents.js' },
    vimeo: { url: 'https://player.vimeo.com/api/player.js', ttl: 86400 },
  },
  onEvent: (e) => {
    if (e.type === 'error' || e.type === 'degraded') console.error('[secondparty]', e.key, e.type, e.error.code)
  },
})
```

`app/routes/__sp.$.tsx` (resource route, mounted outside session middleware: a sibling of the
layout route that holds the session middleware, not a child of it)

```ts
import { handle } from '~/secondparty.config.server'
import { cache } from '~/context'
import type { Route } from './+types/__sp.$'

export const loader = ({ request }: Route.LoaderArgs) => handle(request, { cache })
```

The handler needs the cache to read the record; `handle(request)` alone cannot serve. (ticket 14)

`app/context.ts` (one cache per process; edge runtimes use `await caches.open('secondparty')`)

```ts
import { createMemoryCache } from 'secondparty'
export const cache = createMemoryCache()
```

`app/routes/_index.tsx`

```tsx
import type { Route } from './+types/_index'
import { entries } from '~/secondparty.config.server'
import { cache } from '~/context'

export async function loader() {
  const [klaviyo, vimeo] = await Promise.all([entries.klaviyo({ cache }), entries.vimeo({ cache })])
  return { klaviyoUrl: klaviyo.url, vimeoUrl: vimeo.url }
}

export default function Index({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <script src={loaderData.klaviyoUrl} async />
      <script src={loaderData.vimeoUrl} />
    </>
  )
}
```

## Consumer code: bare Cloudflare Worker

```ts
import { defineSecondparty } from 'secondparty'
const { handle } = defineSecondparty({ entries: { klaviyo: { url: 'https://static.klaviyo.com/onsite/js/klaviyo.js' } } })

export default {
  fetch: async (request: Request) =>
    new URL(request.url).pathname.startsWith('/__sp/')
      ? handle(request, { cache: await caches.open('secondparty') })
      : new Response('', { status: 404 }),
}
```

React Router 8 on Workers (ticket 14): the default server entry picks `renderToPipeableStream`
when `@react-router/node` is a dependency and throws on workerd; ship one `app/entry.server.tsx`
copied from the web default. `getLoadContext` must return a `RouterContextProvider`.

Other mounts (docs only, untested before ticket 14): Astro endpoint `src/pages/__sp/[...path].ts`;
Nuxt `server/routes/__sp/[...].ts`; Next.js `app/__sp/[...path]/route.ts` with `import 'server-only'`.

## Handler contract

Path: `<prefix><key>.<hash>.<ext>`. Regex on the last segment only:
`^(?<key>[A-Za-z0-9_-]+)\.(?<hash>[0-9a-f]{16})\.(?<ext>[a-z0-9]+)$`.

| Condition | Status | `Cache-Control` |
|---|---|---|
| Segment does not match, or key unknown | 404 | `no-store` |
| Method not `GET`/`HEAD` | 405, `Allow: GET, HEAD` | `no-store` |
| Record found, hash matches | 200 | `public, max-age=31536000, s-maxage=31536000, immutable` |
| Record found, hash differs (old HTML) | 200 | `public, max-age=<ttl>, s-maxage=<ttl>` |
| `If-None-Match` equals `"<hash>"` (`W/` stripped) | 304, no body | as above |
| Record stale, vendor error, inside `staleTtl` | 200 + `X-SecondParty-Stale: 1` | `public, max-age=<ttl>, s-maxage=<ttl>` |
| No usable record, vendor error | 502, empty body, `X-SecondParty-Error: <code>` | `no-store` |

Headers on every 200 and 304: `Content-Type` (vendor value verbatim), `Content-Length`,
`ETag: "<hash>"`, `Vary: Accept-Encoding`, `X-Content-Type-Options: nosniff`,
`Access-Control-Allow-Origin: *`, `X-SecondParty-Key`, `X-SecondParty-Fetched-At` (ISO),
`X-SecondParty-Source` (vendor URL), `X-SecondParty-Vendor-Cache-Control` (only when the
vendor sent one). Body is identity-encoded; the platform compresses. Never `Set-Cookie`.

Vendor fetch: `User-Agent: secondparty/<version>` only, no visitor headers, follows
redirects, `If-None-Match` when the record holds `x-sp-etag`, aborts at `timeout`.
Vendor error = timeout, network failure, non-2xx, or Content-Type outside the map
(`text/javascript`, `application/javascript`, `application/x-javascript` → `js`;
`text/css` → `css`; `font/woff2`, `font/woff`, `font/ttf`; `application/json`).

## Entry function contract

| State of the record | Behavior | Event |
|---|---|---|
| Fresh (age < `ttl`) | Return `{ url, degraded: false }` | `hit` |
| Missing or stale, vendor 200 or 304 | Block, store, return `{ url, degraded: false }` | `fetch` |
| Stale inside `staleTtl`, vendor error | Return current `{ url, degraded: false }` | `error`, `stale` |
| No usable record, vendor error | Store 30 s negative record with the error `code`, return `{ url: vendorUrl, degraded: true }` | `error`, `degraded` |
| Inside the negative window | Return `{ url: vendorUrl, degraded: true }`, no fetch; the event and the handler 502 carry the stored `code` (ticket 14) | `degraded` |
| Missing or stale, and a fetch for this key is already in flight in this process (ticket 18) | Wait for that fetch; return its outcome | `hit` on success; `stale` or `degraded` on failure; never `error` |

Single flight (ticket 18): the core keeps one in-flight promise per key per config, in memory. The
first call that needs a vendor fetch is the leader; it fetches, writes the record or the negative
record, and emits `fetch` or `error`. Calls that arrive during the fetch, from the render site or
the handler site, wait for the leader's outcome and emit only their own outcome event with the
leader's `SecondpartyError`. One vendor fault produces one `error` event and one negative record.
The map is per process and per isolate, not per cache object; P processes take P cold fetches per
key. No knob. `waitUntil` and SWR stay out of v1.

The entry function never throws. With no `onEvent`, the core calls `console.warn` once
per `error` and once per `degraded`. A set hook replaces the default; the core wraps it
in try/catch and ignores its return value.

## Validation (ticket 14 target)

Run each row against the RR7 app on Node and on `wrangler dev`. Record the result in the
ticket 14 asset.

1. GIVEN a cold cache WHEN `GET /` THEN the HTML holds `/__sp/klaviyo.<16 hex>.js`, `onEvent`
   receives `fetch` with `site: 'render'`, `status: 200`, and the render blocks once.
2. GIVEN a warm cache WHEN `GET /` THEN `onEvent` receives `hit` and no vendor request occurs.
3. GIVEN the path from row 1 WHEN `curl -I` THEN status 200 and every header in Handler
   contract is present with the 1-year `Cache-Control`; `Set-Cookie` is absent with a
   session cookie on the app.
4. GIVEN the same path WHEN `curl -H 'If-None-Match: "<hash>"'` THEN 304 with no body.
5. GIVEN `/__sp/klaviyo.0000000000000000.js` WHEN `GET` THEN 200, current bytes,
   `max-age=<ttl>`, no `immutable`.
6. GIVEN `/__sp/nope.<hash>.js` WHEN `GET` THEN 404 and no vendor request.
7. GIVEN `POST` on a valid path THEN 405 with `Allow: GET, HEAD`.
8. GIVEN the vendor host blocked (hosts file) and a fresh record WHEN `ttl` expires and `GET /`
   THEN the page renders with the proxied URL, `onEvent` receives `error` then `stale`, and
   the handler response carries `X-SecondParty-Stale: 1`.
9. GIVEN the vendor host blocked and an empty cache WHEN `GET /` THEN the HTML holds the
   vendor URL, `onEvent` receives `error` then `degraded`; a second `GET /` inside 30 s
   receives `degraded` only; `GET` on the asset path answers 502 with `X-SecondParty-Error`.
10. GIVEN a hook that throws WHEN `GET /` THEN the page still renders 200.
11. GIVEN `entries: { bad: { url: 'ftp://x', foo: 1 } }` THEN tsc fails on `foo` and the
    module load throws one `Error` naming `url`.
12. GIVEN the config imported in a client component THEN the runtime throw fires on first
    render (RR7 `.server.ts` blocks it at build).
13. GIVEN Lighthouse on `/` before and after THEN the four entries leave the
    "Use efficient cache lifetimes" list; note which vendors still execute (expect Meta
    to throw `Disallowed script URL`, Klaviyo to refuse, Vimeo and Yotpo loader to run).
14. GIVEN `wrangler dev` WHEN rows 1 to 9 run THEN results match Node, with
    `caches.open('secondparty')` as the cache.

Ticket 14 results (2026-08-30): rows 1 to 14 pass on Node; rows 1 to 10 and 14 pass on
`wrangler dev`. Deviations: rows 8 and 9 used a local stub vendor (no hosts edit); RR 8.3.1, not 7;
`caches.delete()` is unimplemented on miniflare (prototype-only reset). Extra receipts: vendor 304
path, `timeout`/`status`/`content_type` codes, external proxy witness for rows 1 and 2, and 5
concurrent cold renders → 20 vendor fetches before ticket 18. Klaviyo and Meta execute from the
proxied URL; see `.scratch/prototype-14/RESULTS.md`.

Ticket 18 results (2026-08-30, Node and `wrangler dev` identical): 5 concurrent cold renders with
4 entries → 4 vendor fetches, 4 `fetch` and 16 `hit` events, one hash per key; 5 concurrent renders
on a stale record → 1 revalidation (304), 4 `hit`; 5 concurrent cold renders with the vendor down →
1 attempt, 1 `error`, 5 `degraded`, one negative record. Evidence: `.scratch/prototype-14/results/*-18*.json`.

## Test environment (ticket 19)

No test seams on `SecondpartyOptions`. Tests fake `Date` only (`vi.useFakeTimers({ toFake: ['Date'] })`)
and point entries at a synthetic stub vendor (`test/stub/vendor.ts`). Fixture apps use `ttl` 1 to 3 s.
Levels, cadence, fixtures, and the UAT matrix: `.scratch/secondparty-design/issues/19-test-feedback-loop.md`.
Ids for account-bound vendors come from `SP_*` env vars; no store name in this repo's public files.

## Boundaries for the prototype

- ALWAYS: throwaway code, linked from ticket 14, never merged. Verbatim vendor bodies.
- ASK FIRST: any dependency beyond `react-router`, `wrangler`, `vitest`.
- NEVER: rewrite vendor bytes, add a CLI, add a bundler plugin, commit vendor bytes.

## Out of scope for v1

Static-only hosts, pinned copies, body rewrite, chained loads a vendor hardcodes to its CDN,
Vercel Edge runtime (no Cache API), Next.js on webpack, SWR revalidation, per-entry `onEvent`.
