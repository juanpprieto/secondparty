# Plan D: Hydrogen Fixture, UAT Docs, and Nightly Job Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Plans A-C must be complete.

**Goal:** Add the manual-UAT surface: the Hydrogen fixture (level M on Oxygen), the `docs/uat/` checklists, and the nightly real-vendor job (level N).

**Architecture:** The Hydrogen fixture is a scaffolded skeleton app plus five secondparty files; it never runs in CI (ticket 19 §5). UAT results are recorded in `docs/uat/*.md` as dated tables under a fixed checklist. The nightly job fetches real vendors server-side through the built core — no browser, so no pageview reaches any store account. Account-bound ids come from `SP_*` secrets and skip with a logged notice when absent.

**Tech Stack:** `@shopify/hydrogen` skeleton, GitHub Actions cron, `gh` CLI for the failure issue.

**Rules:** No store name or real account id in any committed file. Ids come from `SP_*` env vars; prose uses `XXXX`. Hydrogen dev must not use port 3000 (taken): use 3200.

**Before every session:** `source ~/.nvm/nvm.sh`.

---

### Task D1: fixtures/hydrogen scaffold

**Files:**
- Create: `fixtures/hydrogen/` (scaffold output)
- Create: `fixtures/hydrogen/app/secondparty.config.server.ts`
- Create: `fixtures/hydrogen/app/routes/__sp.$.tsx`
- Modify: the scaffold's context file (usually `app/lib/context.ts`)
- Modify: the scaffold's index route (`app/routes/_index.tsx`)
- Modify: `fixtures/hydrogen/package.json`

**Step 1: Scaffold the skeleton**

```bash
cd fixtures
pnpm create @shopify/hydrogen@latest -- --path hydrogen --template skeleton --language ts --no-install-deps --mock-shop
cd ..
```

Flag names drift between CLI versions. The required outcome: a TypeScript skeleton in `fixtures/hydrogen` wired to mock.shop, no Shopify login needed. If a flag fails, run the interactive prompt and pick: skeleton, TypeScript, mock.shop, no routes scaffolding beyond the default.

Then in `fixtures/hydrogen/package.json`:
- set `"name": "hydrogen-fixture"`, `"private": true`
- add `"secondparty": "workspace:*"` to dependencies
- change the dev script to use port 3200: `"dev": "shopify hydrogen dev --codegen --port 3200"` (drop `--codegen` if the scaffold did not include it)

Run `pnpm install`.

**Step 2: Write the config (env-driven; Oxygen delivers env per request, so the config is lazy and memoized per isolate)**

`app/secondparty.config.server.ts`:

```ts
import { defineSecondparty, type CacheLike } from 'secondparty'

// Oxygen provides env at request time, not at module load. Build the config once
// per isolate from the first request's env. Ids come from SP_* vars; never commit one.
type SpEnv = { SP_KLAVIYO_COMPANY_ID?: string; SP_YOTPO_LOADER_ID?: string }

let sp: ReturnType<typeof defineSecondparty<Record<string, { url: string; ttl?: number }>>> | undefined

export function getSecondparty(env: SpEnv) {
  if (sp) return sp
  const entries: Record<string, { url: string; ttl?: number }> = {
    fbevents: { url: 'https://connect.facebook.net/en_US/fbevents.js' },
    vimeo: { url: 'https://player.vimeo.com/api/player.js', ttl: 86400 },
  }
  if (env.SP_KLAVIYO_COMPANY_ID) {
    entries.klaviyo = { url: `https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=${env.SP_KLAVIYO_COMPANY_ID}` }
  }
  if (env.SP_YOTPO_LOADER_ID) {
    entries.yotpo = { url: `https://cdn-widgetsrepository.yotpo.com/v1/loader/${env.SP_YOTPO_LOADER_ID}` }
  }
  sp = defineSecondparty({
    entries,
    onEvent: (e) =>
      console.log(
        JSON.stringify({
          sp: e.type,
          key: e.key,
          site: e.site,
          hash: 'hash' in e ? e.hash : undefined,
          status: 'status' in e ? e.status : undefined,
          code: 'error' in e ? e.error.code : undefined,
        }),
      ), // the README's JSON-lines recipe; read it with Shopify CLI logs
  })
  return sp
}

export type Secondparty = ReturnType<typeof getSecondparty>
export type SpContext = { secondparty: Secondparty; spCache: CacheLike }
```

**Step 3: Wire `additionalContext` (ticket 19 §5: prove the `additionalContext` wiring)**

In the scaffold's context file (usually `app/lib/context.ts`), inside the function that calls `createHydrogenContext`, add before the call:

```ts
import { getSecondparty } from '~/secondparty.config.server'
// ...
const spCache = (await caches.open('secondparty')) as unknown as import('secondparty').CacheLike
```

and pass as the additional context argument:

```ts
{ secondparty: getSecondparty(env as Parameters<typeof getSecondparty>[0]), spCache }
```

Extend the scaffold's context type declaration with `SpContext` so `context.secondparty` and `context.spCache` type-check. The scaffold's exact shape varies; the required outcome: every loader can read `context.secondparty` and `context.spCache`.

**Step 4: Write the resource route**

`app/routes/__sp.$.tsx` — register it the way the scaffold registers routes (file convention or a `routes.ts` entry):

```ts
import type { LoaderFunctionArgs } from 'react-router'

export async function loader({ request, context }: LoaderFunctionArgs) {
  const res = await context.secondparty.handle(request, { cache: context.spCache })
  // Oxygen splits caching: Cache-Control reaches the browser; the CDN needs
  // Oxygen-Cache-Control on the route (ticket 11; README Platforms section).
  const cc = res.headers.get('cache-control')
  if (cc && cc !== 'no-store') res.headers.set('Oxygen-Cache-Control', cc)
  return res
}
```

**Step 5: Reference two entries in the index route**

In the scaffold's index route loader, add:

```ts
const cache = context.spCache
const [vimeo, fbevents] = await Promise.all([
  context.secondparty.entries.vimeo({ cache }),
  context.secondparty.entries.fbevents({ cache }),
])
```

Return `vimeoUrl: vimeo.url, fbeventsUrl: fbevents.url` with the loader data, and render in the component:

```tsx
<script src={data.vimeoUrl} />
<script src={data.fbeventsUrl} />
```

**Step 6: Local smoke (mock.shop, workerd runtime, Cache API live)**

```bash
pnpm --filter hydrogen-fixture dev &
sleep 8
curl -s http://localhost:3200/ | grep -o '/__sp/[a-z]*\.[0-9a-f]\{16\}\.js'
curl -sI "http://localhost:3200$(curl -s http://localhost:3200/ | grep -o '/__sp/vimeo\.[0-9a-f]\{16\}\.js' | head -1)"
pkill -f 'hydrogen dev'
```

Expected: two asset paths in the HTML; the header dump shows the 1-year `Cache-Control` and the `X-SecondParty-*` headers. This smoke fetches two public vendor URLs once; that is level-N-like traffic, no store account involved.

**Step 7: Typecheck**

Run: `pnpm --filter hydrogen-fixture typecheck` (or the scaffold's equivalent script).
Expected: exits 0.

**Step 8: Commit**

```bash
git add fixtures/hydrogen pnpm-lock.yaml
git commit -m "feat: hydrogen fixture (additionalContext wiring, Oxygen-Cache-Control route)"
```

### Task D2: docs/uat/workers.md

**Files:**
- Create: `docs/uat/workers.md`

**Step 1: Write the checklist document**

```markdown
# UAT: React Router fixture on a Cloudflare Workers preview

Manual level M (ticket 19). Run against a preview deploy of `fixtures/rr-workers`
with real vendor entries. Record every run as a dated section below the checklist.

## Deploy

1. `source ~/.nvm/nvm.sh`
2. Point the fixture at real vendors: set `SP_STUB_ORIGIN` unset and swap the stub
   entries for real vendor URLs via `SP_*` vars in `wrangler.jsonc` `vars` for the
   preview only. Never commit real ids.
3. `pnpm --filter rr-workers build`
4. `cd fixtures/rr-workers && wrangler versions upload --config build/server/wrangler.json`
5. Note the per-version preview URL from the output.

## Reading logs

- `wrangler tail <worker> --format json` streams the fixture's JSON-lines `onEvent` output.
- Set `SP_FIXTURE_DEBUG=1` as a preview var to enable `/__debug` (fixture-only route).

## curl -I checklist (ticket 15 §6)

Replace `BASE` and the hash. Check every row; paste the header dumps into the run record.

| # | Case | Command | Expect |
|---|---|---|---|
| 1 | current hash | `curl -sI BASE/__sp/<key>.<hash>.<ext>` | 200; `cache-control: public, max-age=31536000, s-maxage=31536000, immutable`; `etag: "<hash>"`; `x-secondparty-key`, `-fetched-at`, `-source` |
| 2 | old hash | `curl -sI BASE/__sp/<key>.0000000000000000.<ext>` | 200; `public, max-age=<ttl>, s-maxage=<ttl>`; no `immutable` |
| 3 | If-None-Match | `curl -sI -H 'If-None-Match: "<hash>"' BASE/__sp/<key>.<hash>.<ext>` | 304, no body |
| 4 | unknown key | `curl -sI BASE/__sp/nope.<hash>.js` | 404; `no-store` |
| 5 | POST | `curl -sI -X POST BASE/__sp/<key>.<hash>.<ext>` | 405; `allow: GET, HEAD` |
| 6 | with a session cookie | `curl -sI -H 'Cookie: __session=x' BASE/__sp/<key>.<hash>.<ext>` | no `set-cookie` |
| 7 | CDN behavior | `curl -sI BASE/__sp/<key>.<hash>.<ext>` twice | `cf-cache-status` appears on origin fetches only; Worker responses are never CDN-cached — the Cache API record is the shared cache (ADR 0001) |

## Production Cache API checks

- Two requests to one asset path from one region: the second one must not produce a
  vendor fetch (`wrangler tail`: no `"sp":"fetch"` line).
- Multi-isolate divergence (ADR 0001): `curl -sI` the same path from two regions
  (for example through `curl --resolve` against two POPs or a VPN). Different hashes
  within one `ttl` are correct; every hash serves the key's current bytes.

## Vendor execution (Chrome; effect, not absence of errors)

Load the preview page with claude-in-chrome or by hand. Per vendor, check the effect:

| Vendor | Effect to check | Expected |
|---|---|---|
| Klaviyo | `window._learnq` / Klaviyo object present; requests to klaviyo.com | runs |
| Meta | `window.fbq` defined; `tr` pixel request fires | runs (`signals/config` and `tr` stay on Meta — chained nodes) |
| Yotpo | loader requests widget bundles | runs (bundles stay on Yotpo) |
| Vimeo | `window.Vimeo` defined | runs |
| Awin | conversion tag activity | loads, never tracks — do not proxy (ticket 17); listed here to confirm the README claim only |

## Runs

<!-- One dated section per run. Template: -->

### YYYY-MM-DD — <preview URL>

| Check | Result | Evidence |
|---|---|---|
| curl rows 1-7 | | header dumps |
| Cache API warm | | tail excerpt |
| Multi-isolate | | curl dumps |
| Vendors | | table + screenshots |
```

**Step 2: Commit**

```bash
git add docs/uat/workers.md
git commit -m "docs: Workers preview UAT checklist"
```

### Task D3: docs/uat/oxygen.md

**Files:**
- Create: `docs/uat/oxygen.md`

**Step 1: Write the checklist document**

Same structure as `workers.md` with these Oxygen-specific differences:

```markdown
# UAT: Hydrogen fixture on Oxygen

Manual level M (ticket 19). Run against a dev-store deploy of `fixtures/hydrogen`.

## Deploy

1. `source ~/.nvm/nvm.sh`
2. Set `SP_KLAVIYO_COMPANY_ID` / `SP_YOTPO_LOADER_ID` as Oxygen environment variables
   for the preview environment (Shopify admin or CLI). Never commit ids.
3. `pnpm --filter hydrogen-fixture build` (Hydrogen's own build), then deploy with the
   Shopify CLI (`shopify hydrogen deploy`) against the dev store.

## Reading logs

- Shopify CLI log stream for the dev store shows the JSON-lines `onEvent` output.

## curl -I checklist

Rows 1-6 identical to docs/uat/workers.md. Row 7 becomes:

| 7 | CDN hit | `curl -sI BASE/__sp/<key>.<hash>.<ext>` twice | second response `Oxygen-Full-Page-Cache: Hit` — requires the route's `Oxygen-Cache-Control` line (ticket 11) |

Plus:

| 8 | Oxygen-Cache-Control present at origin | first (Miss) response | route sets it from the handler's Cache-Control |
| 9 | Set-Cookie absent | any asset response | a Set-Cookie disables Oxygen CDN caching silently (ticket 11) |

## Vendor execution

Same table as docs/uat/workers.md.

## Runs

<!-- One dated section per run; same template. -->
```

**Step 2: Commit**

```bash
git add docs/uat/oxygen.md
git commit -m "docs: Oxygen UAT checklist"
```

### Task D4: nightly real-vendor script (level N)

**Files:**
- Create: `scripts/nightly.mjs`

**Step 1: Write the script**

```js
// Level N (ticket 19): fetch real vendors server-side through the built core.
// No browser: no pageview reaches any store account. Account-bound ids come from
// SP_* env vars and skip with a logged notice when absent. Asserts, per entry:
// not degraded, no error event, hash stable within the run. Logs whether the vendor
// revalidated with 304 (public CDNs sometimes rotate ETags; that alone never fails the run).
import { createMemoryCache, defineSecondparty } from '../packages/secondparty/dist/index.js'

const entries = {
  fbevents: { url: 'https://connect.facebook.net/en_US/fbevents.js' },
  vimeo: { url: 'https://player.vimeo.com/api/player.js' },
}
const skipped = []
const { SP_KLAVIYO_COMPANY_ID, SP_YOTPO_LOADER_ID, SP_AWIN_AID, SP_SHOP_DOMAIN } = process.env
if (SP_KLAVIYO_COMPANY_ID) {
  entries.klaviyo = { url: `https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=${SP_KLAVIYO_COMPANY_ID}` }
} else skipped.push('klaviyo (SP_KLAVIYO_COMPANY_ID unset)')
if (SP_YOTPO_LOADER_ID) {
  entries.yotpo = { url: `https://cdn-widgetsrepository.yotpo.com/v1/loader/${SP_YOTPO_LOADER_ID}` }
} else skipped.push('yotpo (SP_YOTPO_LOADER_ID unset)')
if (SP_AWIN_AID && SP_SHOP_DOMAIN) {
  entries.awin = {
    url: `https://dr4qe3ddw9y32.cloudfront.net/awin-shopify-integration-code.js?aid=${SP_AWIN_AID}&shop=${SP_SHOP_DOMAIN}`,
  }
} else skipped.push('awin (SP_AWIN_AID or SP_SHOP_DOMAIN unset)')

const events = []
// ttl 0.05 s: the second call revalidates (If-None-Match when the vendor sent an ETag).
const sp = defineSecondparty({ entries, ttl: 0.05, onEvent: (e) => events.push(e) })
const cache = createMemoryCache()
let failed = false

for (const key of Object.keys(entries)) {
  const n0 = events.length
  const first = await sp.entries[key]({ cache })
  await new Promise((r) => setTimeout(r, 100))
  const second = await sp.entries[key]({ cache })
  const evs = events.slice(n0)
  const fetches = evs.filter((e) => e.type === 'fetch')
  const errors = evs.filter((e) => e.type === 'error')
  const hashStable = first.url === second.url
  const ok = !first.degraded && !second.degraded && errors.length === 0 && hashStable
  console.log(
    JSON.stringify({
      key,
      ok,
      degraded: first.degraded || second.degraded,
      statuses: fetches.map((e) => e.status),
      etag304: fetches.some((e) => e.status === 304),
      hashStable,
      errors: errors.map((e) => e.error.code),
    }),
  )
  if (!ok) failed = true
}
for (const s of skipped) console.log(`SKIP: ${s}`)
if (failed) {
  console.error('nightly: FAIL')
  process.exit(1)
}
console.log('nightly: PASS')
```

**Step 2: Run it locally (public vendors only)**

```bash
pnpm --filter secondparty build && node scripts/nightly.mjs
```

Expected: two JSON lines with `"ok":true`, three `SKIP:` notices, `nightly: PASS`.

**Step 3: Commit**

```bash
git add scripts/nightly.mjs
git commit -m "feat: nightly real-vendor fetch-only script (level N)"
```

### Task D5: nightly workflow

**Files:**
- Create: `.github/workflows/nightly.yml`

**Step 1: Write the workflow**

```yaml
name: nightly
on:
  schedule:
    - cron: '17 3 * * *'
  workflow_dispatch: {}

permissions:
  contents: read
  issues: write

jobs:
  real-vendors:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter secondparty build
      - run: node scripts/nightly.mjs
        env:
          SP_KLAVIYO_COMPANY_ID: ${{ secrets.SP_KLAVIYO_COMPANY_ID }}
          SP_YOTPO_LOADER_ID: ${{ secrets.SP_YOTPO_LOADER_ID }}
          SP_AWIN_AID: ${{ secrets.SP_AWIN_AID }}
          SP_SHOP_DOMAIN: ${{ secrets.SP_SHOP_DOMAIN }}
      - name: Open an issue on failure (nightly never blocks a push)
        if: failure()
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh issue create \
            --title "nightly real-vendor run failed ($(date -u +%F))" \
            --body "Run: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
```

**Step 2: Commit**

```bash
git add .github/workflows/nightly.yml
git commit -m "ci: nightly real-vendor job with failure issue"
```

### Task D6: plan checkpoint

Run: `pnpm --filter secondparty test && pnpm test:integration && node scripts/nightly.mjs`
Expected: all pass (nightly with three SKIP notices).

**CHECKPOINT — stop and review before plan E.** Report: the hydrogen smoke output (asset paths + header dump), which scaffold files needed adaptation in D1 steps 3-5, and the nightly output. Note: the Oxygen and Workers-preview UAT runs happen after v1 lands; `docs/uat/*.md` ship with empty "Runs" sections (map: "outcomes recorded during implementation, not decisions").
