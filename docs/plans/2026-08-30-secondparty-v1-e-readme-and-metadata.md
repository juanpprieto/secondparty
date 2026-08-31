# Plan E: README and Package Metadata Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Plans A-D must be complete.

**Goal:** Ship the README with ticket 15's final text, finish the package metadata, and run the whole-effort success test. No publish.

**Architecture:** The README lives at `packages/secondparty/README.md` (npm reads it from the package dir). The root `README.md` is a short pointer. Ticket 15 fixed the text: the tagline, the section order, the eight limitation paragraphs, and the tables are copied, not rewritten. License: MIT (user decision, 2026-08-31).

---

### Task E1: the README

**Files:**
- Create: `packages/secondparty/README.md`
- Create: `README.md` (root pointer)

**Step 1: Write `packages/secondparty/README.md`**

The full text follows. Sections 4 (Limitations), 5 (Vendors), 6's "Tested on" table, 7's checklist, and 10 (Vendor terms) are ticket 15's wording verbatim — do not edit them. Sections 2 and 3 assemble from the spec and CONTEXT.md as shown.

````markdown
# secondparty

**Third-party scripts on first-party URLs, cached for a year.**

Serves third-party static assets (script, style, font) from the app origin through a
runtime proxy, so the browser caches them for a year.

## Quick start (React Router 7 on Node)

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

`app/context.ts` (one cache per process; edge runtimes use `await caches.open('secondparty')`)

```ts
import { createMemoryCache } from 'secondparty'
export const cache = createMemoryCache()
```

`app/routes/__sp.$.tsx` — a resource route mounted outside the session middleware: a
sibling of the layout route that holds the session, not a child of it.

```ts
import { handle } from '~/secondparty.config.server'
import { cache } from '~/context'
import type { Route } from './+types/__sp.$'

export const loader = ({ request }: Route.LoaderArgs) => handle(request, { cache })
```

Any loader:

```tsx
import { entries } from '~/secondparty.config.server'
import { cache } from '~/context'

export async function loader() {
  const { url } = await entries.klaviyo({ cache })
  return { klaviyoUrl: url }
}
```

Render `<script src={loaderData.klaviyoUrl} async />`. Done: the script now loads from
`/__sp/klaviyo.<hash>.js` with a one-year cache lifetime.

## How it works

An **entry** is one vendor asset you declare: a key plus a vendor URL. The entry
function fetches the vendor bytes through a cache you pass in, stores a **record**
(decoded bytes, content type, hash, fetched-at time), and returns the **asset path**:
`/__sp/<key>.<hash>.<ext>`. The **hash** is SHA-256 over the decoded bytes, hex, 16
chars. The handler serves that path with
`Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable` and answers
`If-None-Match` with 304.

The core owns freshness. Each entry has a fixed `ttl` (default 1 hour). The vendor's
`Cache-Control` is ignored. A stale record blocks the render until revalidation;
revalidation sends `If-None-Match` when the vendor sent an ETag. Retention is
`staleTtl` (default 7 days): inside it a vendor error serves stale; outside it the
handler answers 502. After a vendor fault with no usable record, the entry function
returns the vendor URL itself (a **degraded result**) so the page still renders, and a
30-second **negative record** stops retry storms.

**Single flight:** one vendor fetch per key per process at a time. Calls that arrive
during it — from renders or from the handler — wait for that fetch's outcome.

The config is one server file. `defineSecondparty` infers one typed entry function per
key; unknown keys and excess fields fail to compile. Keep the file server-only:
`.server.ts` in React Router and Remix, `import 'server-only'` in Next.js,
`server/utils/` in Nuxt. Astro and plain Vite rely on the runtime throw
(`defineSecondparty` throws when a `document` global exists).

Design facts: no CLI, no bundler plugin, no vendor bytes in the repo, no log schema.
Bodies are verbatim — `secondparty` never rewrites vendor code. Builds are not
reproducible for vendor bytes: production serves what the vendor served at the last
revalidation.

## Limitations

**1. Freshness is bounded by `ttl`.** Each entry has a fixed `ttl` (default 1 hour). Inside it every
visitor gets the record fetched last, whatever the vendor serves now. Past it the next render
revalidates and the hash changes. A vendor change lands within one `ttl`. The old asset path keeps
serving the current bytes, so stale HTML never 404s. `secondparty` ignores the vendor's
`Cache-Control`. Set a shorter `ttl` on entries whose vendor ships hotfixes.

**2. Chained nodes stay on the vendor CDN.** An entry covers one URL: the one your page references.
Bodies are verbatim, so a loader that builds child URLs keeps loading them from the vendor CDN with
the vendor's cache lifetime. Lighthouse lists the residual per URL. Examples seen on a live
storefront: Meta `signals/config` and the `tr` pixel, Clarity `clarity.js`, Global-e
`freeShippingBanner` and `cookieConsentScript`, Forter `main.<hash>.js`. A relative `url()` in a
proxied stylesheet or a relative `sourceMappingURL` resolves under your prefix and answers 404; an
absolute one stays on the vendor CDN. Declaring a child URL as its own entry changes nothing unless
your page references that asset path.

**3. Vendors that self-locate.** Some vendor scripts find their own `<script>` tag by URL. Awin
`awin-shopify-integration-code.js` scans script tags for its file name, finds none under the prefix,
and exits before it tracks: no error, no cookie, no pixel. Do not proxy Awin. Klaviyo, Meta
`fbevents.js`, the Yotpo loader, and Vimeo `player.js` run from the asset path (see Vendors). For any
other vendor, test for effect, not for absence of errors: load the page with the proxied script and
check the vendor's globals, network requests, and dashboard.

**4. Static-only hosts and Vercel Edge.** The handler and the entry functions run on a server at
request time. A static export (Astro static, a SPA on S3, GitHub Pages) has no server; it cannot use
`secondparty` and keeps the Lighthouse flag. Vercel Edge runtime has no Cache API and is unsupported.
Vercel Node functions work.

**5. A degraded result serves the vendor URL.** When no record is usable (cold cache and the vendor
fails, or a record older than `staleTtl`), the entry function returns the vendor URL with
`degraded: true`. The page renders, the vendor serves the file, and Lighthouse flags it until the
next successful fetch. The entry function never throws. The handler answers 502 on the same condition
and never redirects to the vendor.

**6. Vendor faults.** A vendor fault is a timeout (default 5 s), a network failure, a non-2xx status,
or a Content-Type outside the map. After a fault with no usable record the core stores a negative
record for 30 s. Renders and handler requests inside that window return the degraded result or 502
without a vendor fetch. There is no size cap: one record holds one body, whatever its length. A font
served as `application/octet-stream` is a fault; the vendor must send a `font/*` Content-Type.

**7. Caches are per process and per data center.** Each Node process and each edge isolate owns its
cache and its single-flight map. Concurrent renders inside one process share one vendor fetch. A
cluster with P processes takes P cold fetches per key; each edge location fetches once. Two locations
can serve different hashes for one entry inside a `ttl`; any hash serves the key's current bytes. In
a monorepo each app owns its cache; nothing is shared.

**8. `Set-Cookie` and cross-origin.** A `Set-Cookie` header on the handler response disables CDN
caching on Cloudflare, Oxygen, and Vercel, with no warning. Mount the handler outside session
middleware (see Platforms). Every response carries `Access-Control-Allow-Origin: *`, so a second
origin can load the asset path; that path is untested. `integrity` attributes do not work: bytes
rotate per `ttl`.

## Vendors

| Vendor | File | Runs from the asset path | Note |
|---|---|---|---|
| Klaviyo | `onsite/js/klaviyo.js?company_id=XXXX` | yes | chained chunks already 30 d or 1 y |
| Meta | `fbevents.js` | yes | `signals/config` and `tr` stay on Meta |
| Yotpo | `v1/loader/XXXX` | yes | widget bundles stay on Yotpo, already 1 y |
| Vimeo | `player.js` | yes | MIT on npm; install `@vimeo/player` instead |
| Awin | `awin-shopify-integration-code.js` | loads, never tracks | do not proxy |

## Platforms

**Cloudflare Workers**

```ts
import { defineSecondparty } from 'secondparty'
const { handle } = defineSecondparty({ entries: { klaviyo: { url: 'https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=XXXX' } } })

export default {
  fetch: async (request: Request) =>
    new URL(request.url).pathname.startsWith('/__sp/')
      ? handle(request, { cache: await caches.open('secondparty') })
      : new Response('', { status: 404 }),
}
```

React Router on Workers: ship a web `entry.server.tsx` (the default picks the Node
pipeable-stream entry when `@react-router/node` is a dependency, and that entry throws
on workerd), and return a `RouterContextProvider` from `getLoadContext`.

**Oxygen (Hydrogen)** — the CDN needs `Oxygen-Cache-Control` on the route:

```ts
export async function loader({ request, context }: LoaderFunctionArgs) {
  const res = await handle(request, { cache: await caches.open('secondparty') })
  const cc = res.headers.get('cache-control')
  if (cc && cc !== 'no-store') res.headers.set('Oxygen-Cache-Control', cc)
  return res
}
```

**Node** — use the quick start. Bodies leave identity-encoded and the platform
compresses; `react-router-serve` already does. Behind bare `node:http` or Express, add
compression middleware yourself.

**Vercel** — Node functions work: mount per your framework as above. The Edge runtime
has no Cache API and is unsupported.

**Netlify** — Functions (Node) use `createMemoryCache()`; Edge Functions have the Cache
API (`await caches.open('secondparty')`).

**Astro** — endpoint `src/pages/__sp/[...path].ts`:

```ts
import type { APIRoute } from 'astro'
import { handle } from '../../secondparty.config.server'
import { cache } from '../../cache.server'

export const ALL: APIRoute = ({ request }) => handle(request, { cache })
```

**Nuxt** — `server/routes/__sp/[...].ts`:

```ts
import { handle } from '~~/server/utils/secondparty.config'
import { cache } from '~~/server/utils/sp-cache'

export default defineEventHandler((event) => handle(toWebRequest(event), { cache }))
```

**Next.js** — `app/__sp/[...path]/route.ts`:

```ts
import 'server-only'
import { handle } from '@/secondparty.config.server'
import { cache } from '@/sp-cache'

export const GET = (request: Request) => handle(request, { cache })
export const HEAD = GET
```

**Tested on**

| Framework | Platform | Checked by |
|---|---|---|
| React Router 7 | Node 22 | CI (integration, Lighthouse) |
| React Router 7 | Cloudflare Workers | CI (`wrangler dev`), manual preview (`docs/uat/workers.md`) |
| Hydrogen | Oxygen | manual (`docs/uat/oxygen.md`) |
| Astro, Nuxt, Next.js | any | untested; mount shown |
| any | Vercel, Netlify | untested; mount shown |

## Observability

Every 200 and 304 carries `X-SecondParty-Key`, `X-SecondParty-Fetched-At`,
`X-SecondParty-Source`, and `X-SecondParty-Vendor-Cache-Control` (when the vendor sent
one). A stale serve adds `X-SecondParty-Stale: 1`. A 502 carries
`X-SecondParty-Error: <code>`.

One hook, JSON-lines recipe:

```ts
onEvent: (e) => console.log(JSON.stringify({ sp: e.type, key: e.key, site: e.site, hash: 'hash' in e ? e.hash : undefined, status: 'status' in e ? e.status : undefined, code: 'error' in e ? e.error.code : undefined }))
```

Read it with `wrangler tail --format json` on Workers, or the Shopify CLI log stream on
Oxygen. Without a hook, the core calls `console.warn` once per `error` and once per
`degraded`. Caches are per data center: two locations can hold different hashes for one
entry inside a `ttl`.

`curl -I` checklist:

| Case | Expect |
|---|---|
| current hash | 200; `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable`; `ETag: "<hash>"`; `X-SecondParty-Key`, `-Fetched-At`, `-Source` |
| old hash | 200; `public, max-age=<ttl>, s-maxage=<ttl>`; no `immutable` |
| `If-None-Match: "<hash>"` | 304, no body |
| vendor down, record inside `staleTtl` | 200; `X-SecondParty-Stale: 1`; `max-age=<ttl>` |
| vendor down, no record | 502; `X-SecondParty-Error: <code>`; `no-store` |
| unknown key | 404; `no-store` |
| `POST` | 405; `Allow: GET, HEAD` |
| with a session cookie | no `Set-Cookie` |
| CDN hit | `Oxygen-Full-Page-Cache: Hit` (needs the `Oxygen-Cache-Control` line); `x-vercel-cache: HIT`; `cf-cache-status` on origin fetches only, Worker responses are never CDN-cached |

## Configuration reference

Durations are in seconds; fractions are allowed.

| Option | Default | Meaning |
|---|---|---|
| `entries` | — | one `{ url, ttl?, staleTtl?, timeout? }` per key |
| `ttl` | `3600` | freshness window per record |
| `staleTtl` | `604800` | retention window: serve stale on vendor error inside it |
| `timeout` | `5` | vendor fetch abort |
| `prefix` | `'/__sp/'` | asset-path prefix used by the entry functions |
| `userAgent` | `secondparty/<version>` | the only header sent to the vendor |
| `onEvent` | `console.warn` on `error`/`degraded` | receives `hit`, `fetch`, `stale`, `degraded`, `error` |

Per-entry `url`, `ttl`, `staleTtl`, `timeout` override the flat options.

`defineSecondparty` throws one `Error` at module load that lists every failed check:
key charset `[A-Za-z0-9_-]+`; `url` parses as `http:` or `https:`; `ttl > 0`;
`staleTtl >= ttl` after the per-entry merge; `timeout > 0`; `prefix` starts with `/`.
It also throws when a `document` global exists (client-import guard).

## Testing your integration

Test for effect, not for absence of errors: load the page with the proxied script and
check the vendor's globals, network requests, and dashboard. Lighthouse 13 reports
cache lifetimes under the `cache-insight` audit ("Use efficient cache lifetimes");
after the swap, your entries leave that list. Deployed-platform checklists:
`docs/uat/workers.md`, `docs/uat/oxygen.md` in the repository.

## Vendor terms

No vendor terms we read name a proxy. Every vendor we read carries a generic no-copy clause. Read the
terms of every vendor you declare before you ship. Google ships its own first-party path, the Google
tag gateway; use it for Google tags. Vimeo `player.js` is MIT on npm as `@vimeo/player`; install it
instead of proxying it.

## License

MIT
````

**Step 2: Write the root `README.md`**

```markdown
# secondparty (workspace)

The package and its README live in [`packages/secondparty`](packages/secondparty/README.md).

- `packages/secondparty` — the library
- `fixtures/` — test apps (rr-node, rr-workers, hydrogen)
- `integration/` — validation-row and Lighthouse suites
- `docs/` — spec, ADRs, plans, UAT checklists
```

**Step 3: Check the honesty rules**

Run: `grep -riE 'emmylondon|emmy\.myshopify' README.md packages/secondparty/README.md docs; grep -i 'zero drift' packages/secondparty/README.md; true`
Expected: no store name anywhere; "zero drift" appears nowhere in the README (ticket 15). ("zero drift" inside `docs/plans/2026-08-29-naming-design.md` and the ADR is history, not README text — the grep above only guards the README.)

**Step 4: Commit**

```bash
git add README.md packages/secondparty/README.md
git commit -m "docs: README from ticket 15 final text (tagline, 8 limitations, tables)"
```

### Task E2: LICENSE and package metadata

**Files:**
- Create: `packages/secondparty/LICENSE`
- Modify: `packages/secondparty/package.json`

**Step 1: Write the MIT license**

`packages/secondparty/LICENSE` — the standard MIT text with the line:

```
Copyright (c) 2026 secondparty contributors
```

(Change the holder name if you want your legal name; ask the user at execution time only if they flagged it.)

**Step 2: Finish `package.json`**

Add to `packages/secondparty/package.json`:

```json
"keywords": ["third-party", "proxy", "cache", "lighthouse", "performance", "self-host", "scripts"],
"files": ["dist", "README.md", "LICENSE"]
```

Check the final shape: `name` `secondparty`, `version` `0.1.0` (equal to `src/version.ts`), `description` = the tagline sentence, `license` `MIT`, `type` `module`, `exports` with `types` first, `sideEffects: false`, `engines.node >=20`. No `repository` field until a remote exists. No publish.

**Step 3: Pack a dry run (no publish)**

Run: `pnpm --filter secondparty pack --dry-run 2>/dev/null || (cd packages/secondparty && npm pack --dry-run)`
Expected: the tarball lists `dist/`, `README.md`, `LICENSE`, `package.json` and nothing else.

**Step 4: Commit**

```bash
git add packages/secondparty/LICENSE packages/secondparty/package.json
git commit -m "chore: package metadata and MIT license"
```

### Task E3: final verification — the whole-effort success test

**Step 1: Clean run of every level**

```bash
source ~/.nvm/nvm.sh
pnpm install --frozen-lockfile
pnpm --filter secondparty build
pnpm --filter secondparty test:types
pnpm --filter secondparty test
pnpm --filter rr-node build && pnpm --filter rr-workers build
SP_SKIP_FIXTURE_BUILD=1 pnpm test:integration
node scripts/nightly.mjs
```

Expected: every command exits 0.

**Step 2: Check the coverage mapping**

Confirm each line; report the table with pass marks:

| Spec validation row | Proven by |
|---|---|
| 1, 2 | U (node + workerd), I (rr-node + rr-workers) |
| 3-7 | U, I (both) |
| 8, 9 | U (all four codes, fake Date), I (toggle-500 deviation, recorded) |
| 10 | U, I |
| 11 | T (`@ts-expect-error foo`), U (load throw names `url`) |
| 12 | U (document-global throw); `.server.ts` build guard is RR-inherent |
| 13 | E (cache-insight clean on `/`, flagged on `/before`, `window.__sp` executes); real-vendor half is level M by design |
| 14 | U workerd project + I rr-workers parity |
| Receipts A-D, G | U + I as written in ticket 19's matrix |

**Step 3: Check the rules one last time**

```bash
git log --oneline | head -40
grep -riE 'emmylondon|emmy\.myshopify|NfbBz5|4dolcEQMbjLtRV85yyKHHbQ51njE1AfcUl3BdOby|31611' --exclude-dir=node_modules --exclude-dir=.scratch . || echo CLEAN
git status --short
```

Expected: `CLEAN` (no store name, no real account id from the prototype anywhere in committed files); a clean tree; no `.scratch/` path in any commit (`git log --stat | grep scratch` returns nothing).

**Step 4: Final commit and stop**

```bash
git add -A && git commit -m "chore: v1 complete - all push-CI levels green" --allow-empty
```

**FINAL CHECKPOINT — the effort is done when:** every push-CI case in ticket 19's matrix passes; the spec's 14 validation rows pass on Node and rows 1-10 and 14 on `wrangler dev` (per the mapping above). Remaining post-v1 outcomes, recorded not planned (map "Hand-off" section): the first `docs/uat/` runs on Workers and Oxygen previews, the Astro runtime-guard check, and "Tested on" row upgrades.
