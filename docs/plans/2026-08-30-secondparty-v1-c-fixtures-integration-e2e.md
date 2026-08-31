# Plan C: Fixtures, Integration, and E2E Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Plans A and B must be complete.

**Goal:** Prove the spec's validation rows against built apps: `rr-node` on `react-router-serve` (port 3100), `rr-workers` on `wrangler dev` (port 8790), plus the Lighthouse `cache-insight` E2E with an execution check.

**Architecture:** Two fixture apps under `fixtures/`, both consuming `secondparty` via `workspace:*` and pointing every entry at the stub vendor on port 4567. One shared row suite (`integration/rows.ts`) runs against both. The fixture `/__debug` route exists only behind `SP_FIXTURE_DEBUG=1` and is fixture code, never core code (ticket 19 §4). App files lift from `.scratch/prototype-14/` (throwaway reference).

**Tech Stack:** React Router 8.3.1, `@react-router/serve`, `@cloudflare/vite-plugin` 1.54.2, wrangler 4.127.1, vitest at the root, Lighthouse 13.4.1 + chrome-launcher, raw CDP over Node `WebSocket` for the execution check.

**Ports:** 3100 (rr-node), 8790 (wrangler dev), 4567 (stub). Never 3000 or 8787.

**Before every session:** `source ~/.nvm/nvm.sh`.

---

### Task C1: fixtures/rr-node scaffold

**Files:**
- Create: `fixtures/rr-node/package.json`
- Create: `fixtures/rr-node/vite.config.ts`
- Create: `fixtures/rr-node/react-router.config.ts`
- Create: `fixtures/rr-node/tsconfig.json`
- Create: `fixtures/rr-node/app/root.tsx`
- Create: `fixtures/rr-node/app/routes.ts`
- Create: `fixtures/rr-node/app/session.server.ts`
- Create: `fixtures/rr-node/app/context.ts`
- Create: `fixtures/rr-node/app/debug.server.ts`
- Create: `fixtures/rr-node/app/secondparty.config.server.ts`
- Create: `fixtures/rr-node/app/routes/_layout.tsx`
- Create: `fixtures/rr-node/app/routes/_index.tsx`
- Create: `fixtures/rr-node/app/routes/before.tsx`
- Create: `fixtures/rr-node/app/routes/slow.tsx`
- Create: `fixtures/rr-node/app/routes/err.tsx`
- Create: `fixtures/rr-node/app/routes/__sp.$.tsx`
- Create: `fixtures/rr-node/app/routes/__debug.tsx`

**Step 1: Write `package.json`**

```json
{
  "name": "rr-node",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "react-router dev",
    "build": "react-router build",
    "start": "react-router-serve ./build/server/index.js",
    "typecheck": "react-router typegen && tsc"
  },
  "dependencies": {
    "secondparty": "workspace:*",
    "@react-router/node": "8.3.1",
    "@react-router/serve": "8.3.1",
    "isbot": "^5.1.36",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-router": "8.3.1"
  },
  "devDependencies": {
    "@react-router/dev": "8.3.1",
    "@types/node": "^22",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "typescript": "5.9.3",
    "vite": "^7.0.0"
  }
}
```

The driver sets `PORT=3100` when it spawns `react-router-serve`.

**Step 2: Write the build config files**

`vite.config.ts`:

```ts
import { reactRouter } from '@react-router/dev/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [reactRouter()],
  resolve: { alias: { '~': new URL('./app', import.meta.url).pathname } },
})
```

`react-router.config.ts`:

```ts
import type { Config } from '@react-router/dev/config'

export default { ssr: true } satisfies Config
```

`tsconfig.json`:

```json
{
  "include": ["**/*.ts", "**/*.tsx", ".react-router/types/**/*"],
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "types": ["node", "vite/client"],
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "rootDirs": [".", "./.react-router/types"],
    "baseUrl": ".",
    "paths": { "~/*": ["./app/*"] },
    "esModuleInterop": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  }
}
```

**Step 3: Write the app shell**

`app/root.tsx`:

```tsx
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
export default function App() {
  return <Outlet />
}
```

`app/routes.ts` (the resource route is a sibling of the session layout, never a child — spec "Consumer code"):

```ts
import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

export default [
  // Session middleware lives on this layout only. /__sp/* stays outside it.
  layout('routes/_layout.tsx', [
    index('routes/_index.tsx'),
    route('before', 'routes/before.tsx'),
    route('slow', 'routes/slow.tsx'),
    route('err', 'routes/err.tsx'),
  ]),
  route('__sp/*', 'routes/__sp.$.tsx'),
  route('__debug', 'routes/__debug.tsx'),
] satisfies RouteConfig
```

`app/session.server.ts`:

```ts
import { createCookieSessionStorage } from 'react-router'

export const { getSession, commitSession } = createCookieSessionStorage({
  cookie: { name: '__session', secrets: ['fixture'], sameSite: 'lax', path: '/', httpOnly: true },
})
```

`app/routes/_layout.tsx`:

```tsx
import { Outlet } from 'react-router'
import type { Route } from './+types/_layout'
import { commitSession, getSession } from '~/session.server'

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }, next) => {
    const session = await getSession(request.headers.get('Cookie'))
    session.set('seen', Date.now())
    const res = await next()
    res.headers.append('Set-Cookie', await commitSession(session))
    return res
  },
]
export default function LayoutRoute() {
  return <Outlet />
}
```

**Step 4: Write the secondparty wiring**

`app/context.ts` (one cache per process on Node; the Cache API on workerd — same file works in both fixtures):

```ts
import { createMemoryCache, type CacheLike } from 'secondparty'

let memory: CacheLike | undefined
const hasCacheApi = () =>
  typeof caches !== 'undefined' && typeof (caches as { open?: unknown }).open === 'function'

export async function getCache(): Promise<CacheLike> {
  if (hasCacheApi()) return (await caches.open('secondparty')) as unknown as CacheLike
  return (memory ??= createMemoryCache())
}

// Fixture-only reset for the integration driver. workerd lacks caches.delete()
// on miniflare, so delete per key (record keys are core-internal knowledge; fixture-only).
export async function resetCache(keys: string[]): Promise<string> {
  if (hasCacheApi()) {
    const c = await caches.open('secondparty')
    for (const k of keys) await c.delete(`https://secondparty.invalid/${k}`)
    return 'cache-api (per-key delete)'
  }
  memory = createMemoryCache()
  return 'memory'
}

export const runtime = () => (hasCacheApi() ? 'workerd' : 'node')
```

`app/debug.server.ts`:

```ts
// Fixture-only. Captures onEvent output for the integration driver (SP_FIXTURE_DEBUG=1)
// or prints the README's JSON-lines recipe otherwise. Never a core feature (ticket 19 §4).
import type { SecondpartyEvent } from 'secondparty'

export type FlatEvent = { type: string; key: string; site: string; hash?: string; status?: number; code?: string }
export const state: { events: FlatEvent[]; throwHook: boolean } = { events: [], throwHook: false }

export function record(e: SecondpartyEvent) {
  if (state.throwHook) throw new Error('hook fault (row 10)')
  const flat: FlatEvent = {
    type: e.type,
    key: e.key,
    site: e.site,
    ...('hash' in e ? { hash: e.hash } : {}),
    ...('status' in e ? { status: e.status } : {}),
    ...('error' in e ? { code: e.error.code } : {}),
  }
  if (process.env.SP_FIXTURE_DEBUG === '1') state.events.push(flat)
  else console.log(JSON.stringify({ sp: flat.type, key: flat.key, site: flat.site, hash: flat.hash, status: flat.status, code: flat.code }))
}
```

`app/secondparty.config.server.ts` (entries point at the stub; ids and origins come from env, never a store name — map rule):

```ts
import { defineSecondparty } from 'secondparty'
import { record } from './debug.server'

const STUB = process.env.SP_STUB_ORIGIN ?? 'http://127.0.0.1:4567'

export const { entries, handle } = defineSecondparty({
  entries: {
    // The four index entries: receipt D expects 4 vendor fetches for 5 concurrent cold renders.
    ok: { url: `${STUB}/ok.js`, ttl: 2, timeout: 2 },
    css: { url: `${STUB}/ok.css`, ttl: 2 },
    rotate: { url: `${STUB}/rotate.js`, ttl: 2 },
    toggle: { url: `${STUB}/toggle.js`, ttl: 2, timeout: 1 },
    // Referenced only by their own routes; they never join the index render.
    slow: { url: `${STUB}/slow.js?ms=3000`, ttl: 2, timeout: 0.5 },
    badct: { url: `${STUB}/html.js`, ttl: 2 },
  },
  onEvent: (e) => record(e),
})
```

**Step 5: Write the routes**

`app/routes/_index.tsx`:

```tsx
import type { Route } from './+types/_index'
import { entries } from '~/secondparty.config.server'
import { getCache } from '~/context'

export async function loader() {
  const cache = await getCache()
  const [ok, css, rotate, toggle] = await Promise.all([
    entries.ok({ cache }),
    entries.css({ cache }),
    entries.rotate({ cache }),
    entries.toggle({ cache }),
  ])
  return { ok: ok.url, css: css.url, rotate: rotate.url, toggle: toggle.url }
}

export default function Index({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>after (proxied)</h1>
      <link rel="stylesheet" href={loaderData.css} />
      <script src={loaderData.ok} />
      <script src={loaderData.rotate} />
      <script src={loaderData.toggle} />
    </main>
  )
}
```

`app/routes/before.tsx` (raw stub URL; Lighthouse must flag it):

```tsx
import type { Route } from './+types/before'

export async function loader() {
  return { url: `${process.env.SP_STUB_ORIGIN ?? 'http://127.0.0.1:4567'}/ok.js` }
}

export default function Before({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>before (vendor URL)</h1>
      <script src={loaderData.url} />
    </main>
  )
}
```

`app/routes/slow.tsx` (receipt B: timeout → degraded render):

```tsx
import type { Route } from './+types/slow'
import { entries } from '~/secondparty.config.server'
import { getCache } from '~/context'

export async function loader() {
  const r = await entries.slow({ cache: await getCache() })
  return { url: r.url, degraded: r.degraded }
}

export default function Slow({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <p data-degraded={String(loaderData.degraded)}>{loaderData.url}</p>
      <script src={loaderData.url} />
    </main>
  )
}
```

`app/routes/err.tsx` — same file shape as `slow.tsx`, with `entries.badct` instead of `entries.slow`.

`app/routes/__sp.$.tsx` (the spec's resource route):

```ts
import type { Route } from './+types/__sp.$'
import { handle } from '~/secondparty.config.server'
import { getCache } from '~/context'

export const loader = async ({ request }: Route.LoaderArgs) => handle(request, { cache: await getCache() })
export const action = async ({ request }: Route.ActionArgs) => handle(request, { cache: await getCache() })
```

`app/routes/__debug.tsx`:

```ts
// Fixture-only, behind SP_FIXTURE_DEBUG=1 (ticket 19 §4). Never a core feature.
import type { Route } from './+types/__debug'
import { state } from '~/debug.server'
import { entries } from '~/secondparty.config.server'
import { resetCache, runtime } from '~/context'

export async function loader({ request }: Route.LoaderArgs) {
  if (process.env.SP_FIXTURE_DEBUG !== '1') throw new Response('Not Found', { status: 404 })
  const q = new URL(request.url).searchParams
  const out: Record<string, unknown> = { runtime: runtime(), events: state.events }
  if (q.has('reset')) out.reset = await resetCache(Object.keys(entries))
  if (q.has('throwhook')) state.throwHook = q.get('throwhook') === '1'
  if (q.has('clear')) state.events = []
  return Response.json(out, { headers: { 'cache-control': 'no-store' } })
}
```

**Step 6: Install and build**

```bash
pnpm install
pnpm --filter secondparty build
pnpm --filter rr-node build
```

Expected: both builds exit 0.

**Step 7: Typecheck the fixture**

Run: `pnpm --filter rr-node typecheck`
Expected: exits 0.

**Step 8: Commit**

```bash
git add fixtures/rr-node pnpm-lock.yaml
git commit -m "feat: rr-node fixture (stub entries, session sibling mount, fixture /__debug)"
```

### Task C2: rr-node manual smoke

**Step 1: Start the stub and the app**

```bash
(cd packages/secondparty && pnpm stub &)
(cd fixtures/rr-node && PORT=3100 SP_STUB_ORIGIN=http://127.0.0.1:4567 SP_FIXTURE_DEBUG=1 pnpm start &)
sleep 3
```

**Step 2: Smoke rows 1 and 3 by hand**

```bash
curl -s http://localhost:3100/ | grep -o '/__sp/ok\.[0-9a-f]\{16\}\.js'
curl -sI "http://localhost:3100$(curl -s http://localhost:3100/ | grep -o '/__sp/ok\.[0-9a-f]\{16\}\.js' | head -1)"
```

Expected: an asset path prints; the header dump shows `cache-control: public, max-age=31536000, s-maxage=31536000, immutable`, the `x-secondparty-*` headers, and no `set-cookie`.

**Step 3: Stop both processes**

```bash
pkill -f 'react-router-serve' ; pkill -f 'test/stub/serve.ts'
```

No commit (no file change).

### Task C3: integration harness at the root

**Files:**
- Create: `integration/vitest.config.ts`
- Create: `integration/global-setup.ts`
- Create: `integration/driver.ts`
- Modify: `package.json` (root)

**Step 1: Install the root devDependencies (approved in the overview)**

```bash
pnpm add -w -D vitest@^3.2 typescript@5.9.3 @types/node@^22 lighthouse@13.4.1 chrome-launcher@^1
```

Match the vitest version to the one `packages/secondparty` uses.

**Step 2: Add the root script**

In the root `package.json` scripts:

```json
"test:integration": "vitest run -c integration/vitest.config.ts"
```

**Step 3: Write `integration/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./integration/global-setup.ts'],
    fileParallelism: false, // fixed ports: 3100, 8790, 4567
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
})
```

**Step 4: Write `integration/global-setup.ts`**

```ts
import { execSync } from 'node:child_process'

export default function setup() {
  if (process.env.SP_SKIP_FIXTURE_BUILD === '1') return // CI builds beforehand
  execSync('pnpm --filter secondparty build', { stdio: 'inherit' })
  execSync('pnpm --filter rr-node build', { stdio: 'inherit' })
  execSync('pnpm --filter rr-workers build', { stdio: 'inherit' })
}
```

(Until task C5 exists, keep the `rr-workers` line commented out, then restore it.)

**Step 5: Write `integration/driver.ts`**

```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startStubVendor, type StubVendor } from '../packages/secondparty/test/stub/vendor.ts'

export const STUB_PORT = 4567
export const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`

export const startStub = (): Promise<StubVendor> => startStubVendor(STUB_PORT)

export type App = { base: string; kill(): Promise<void> }

const fixtureDir = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

async function waitFor(url: string, timeoutMs = 120_000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${url}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve()
    const hard = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => {
      clearTimeout(hard)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

export async function startRrNode(): Promise<App> {
  const child = spawn('node_modules/.bin/react-router-serve', ['./build/server/index.js'], {
    cwd: fixtureDir('rr-node'),
    env: {
      ...process.env,
      PORT: '3100',
      SP_STUB_ORIGIN: STUB_ORIGIN,
      SP_FIXTURE_DEBUG: '1',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  await waitFor('http://localhost:3100/__debug')
  return { base: 'http://localhost:3100', kill: () => killChild(child) }
}

export async function startRrWorkers(): Promise<App> {
  const child = spawn(
    'node_modules/.bin/wrangler',
    ['dev', '--config', 'build/server/wrangler.json', '--port', '8790'],
    { cwd: fixtureDir('rr-workers'), env: { ...process.env }, stdio: ['ignore', 'inherit', 'inherit'] },
  )
  await waitFor('http://localhost:8790/__debug')
  return { base: 'http://localhost:8790', kill: () => killChild(child) }
}

// Fixture debug endpoint (SP_FIXTURE_DEBUG=1).
export type FlatEvent = { type: string; key: string; site: string; hash?: string; status?: number; code?: string }
export async function dbg(base: string, query = ''): Promise<{ runtime: string; events: FlatEvent[] }> {
  const res = await fetch(`${base}/__debug${query}`)
  if (res.status !== 200) throw new Error(`__debug answered ${res.status}`)
  return res.json()
}

// Stub witnesses.
export const stubLog = async (): Promise<Array<{ path: string; ifNoneMatch?: string; cookie?: string }>> =>
  (await fetch(`${STUB_ORIGIN}/__log`)).json()
export const clearStubLog = async () => {
  await fetch(`${STUB_ORIGIN}/__log`, { method: 'DELETE' })
}
export const setToggleMode = async (mode: 'ok' | '500') => {
  await fetch(`${STUB_ORIGIN}/__mode?mode=${mode}`, { method: 'POST' })
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
```

**Step 6: Check it compiles under vitest**

Run: `pnpm test:integration`
Expected: "no test files found" (that is fine) or exits 0.

**Step 7: Commit**

```bash
git add integration package.json pnpm-lock.yaml
git commit -m "test: integration harness (driver, global setup, root vitest config)"
```

### Task C4: shared row suite + rr-node integration test

**Files:**
- Create: `integration/rows.ts`
- Create: `integration/rr-node.test.ts`

**Step 1: Write the failing test**

`integration/rows.ts` — the shared suite. Both fixtures run it (spec row 14 = parity). Receipt values come from the spec's Validation section and ticket 18's notes; the deviations (stub keys, `startsWith` on Content-Type, toggle-500 for rows 8-9) are recorded in the overview.

```ts
import { describe, expect, it } from 'vitest'
import { clearStubLog, dbg, setToggleMode, sleep, stubLog, type App } from './driver.ts'

const TTL = 2 // fixture entries use ttl 2 (ticket 19: fixtures use ttl 1-3 s and real waits)
const assetRe = (key: string, ext = 'js') => new RegExp(`/__sp/${key}\\.([0-9a-f]{16})\\.${ext}`)

export function defineRowTests(getApp: () => App) {
  const base = () => getApp().base
  const reset = async () => {
    await dbg(base(), '?reset=1&clear=1')
    await clearStubLog()
    await setToggleMode('ok')
  }

  it('row 1: cold render holds asset paths, 4 fetch events, 4 stub requests', async () => {
    await reset()
    const html = await (await fetch(`${base()}/`)).text()
    for (const key of ['ok', 'rotate', 'toggle']) expect(html).toMatch(assetRe(key))
    expect(html).toMatch(assetRe('css', 'css'))
    const d = await dbg(base())
    const fetches = d.events.filter((e) => e.type === 'fetch')
    expect(fetches).toHaveLength(4)
    expect(fetches.every((e) => e.site === 'render' && e.status === 200)).toBe(true)
    expect(await stubLog()).toHaveLength(4)
  })

  it('row 2: warm render hits, no vendor request', async () => {
    await reset()
    await (await fetch(`${base()}/`)).text()
    await dbg(base(), '?clear=1')
    await clearStubLog()
    const html = await (await fetch(`${base()}/`)).text()
    expect(html).toMatch(assetRe('ok'))
    const d = await dbg(base())
    expect(d.events.filter((e) => e.key === 'ok' || e.key === 'css' || e.key === 'rotate' || e.key === 'toggle').every((e) => e.type === 'hit')).toBe(true)
    expect(await stubLog()).toHaveLength(0)
  })

  it('rows 3 + receipt C: full header set, 1-year cache, no Set-Cookie with a session', async () => {
    await reset()
    const page = await fetch(`${base()}/`)
    const cookie = page.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toBeTruthy() // the session middleware is live on the layout
    const path = (await page.text()).match(assetRe('ok'))![0]
    const res = await fetch(`${base()}${path}`, { headers: { cookie: cookie! } })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, s-maxage=31536000, immutable')
    expect(res.headers.get('content-type')!.startsWith('text/javascript')).toBe(true) // express may add charset
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{16}"$/)
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('x-secondparty-key')).toBe('ok')
    expect(res.headers.get('x-secondparty-fetched-at')).toMatch(/^\d{4}-/)
    expect(res.headers.get('x-secondparty-source')).toContain('/ok.js')
    expect(res.headers.get('x-secondparty-vendor-cache-control')).toBe('max-age=1')
    expect(res.headers.get('set-cookie')).toBeNull()
    // the asset request carried the cookie and the stub never saw one
    const log = await stubLog()
    expect(log.every((e) => e.cookie === undefined)).toBe(true)
  })

  it('row 4: If-None-Match answers 304 with no body', async () => {
    await reset()
    const html = await (await fetch(`${base()}/`)).text()
    const m = html.match(assetRe('ok'))!
    const res = await fetch(`${base()}${m[0]}`, { headers: { 'if-none-match': `"${m[1]}"` } })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
  })

  it('row 5: an old hash serves current bytes with max-age=<ttl>', async () => {
    await reset()
    await (await fetch(`${base()}/`)).text()
    const res = await fetch(`${base()}/__sp/ok.0000000000000000.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(`public, max-age=${TTL}, s-maxage=${TTL}`)
    expect(await res.text()).toContain('window.__sp')
  })

  it('row 6: unknown key answers 404 and no vendor request', async () => {
    await reset()
    await (await fetch(`${base()}/`)).text()
    await clearStubLog()
    const res = await fetch(`${base()}/__sp/nope.0000000000000000.js`)
    expect(res.status).toBe(404)
    expect(await stubLog()).toHaveLength(0)
  })

  it('row 7: POST answers 405 with Allow: GET, HEAD', async () => {
    await reset()
    const html = await (await fetch(`${base()}/`)).text()
    const path = html.match(assetRe('ok'))![0]
    const res = await fetch(`${base()}${path}`, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it('row 8: vendor error past ttl serves stale (error, stale events; X-SecondParty-Stale)', async () => {
    await reset()
    const warmHtml = await (await fetch(`${base()}/`)).text()
    const warmPath = warmHtml.match(assetRe('toggle'))![0]
    await setToggleMode('500')
    await sleep((TTL + 0.3) * 1000)
    await dbg(base(), '?clear=1')
    const html = await (await fetch(`${base()}/`)).text()
    expect(html.match(assetRe('toggle'))![0]).toBe(warmPath) // same record, same hash
    const d = await dbg(base())
    const toggleEvents = d.events.filter((e) => e.key === 'toggle').map((e) => e.type)
    expect(toggleEvents).toEqual(['error', 'stale'])
    const res = await fetch(`${base()}${warmPath}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-secondparty-stale')).toBe('1')
  })

  it('row 9 + G2: vendor error with no record degrades, 30 s window, 502 with the code', async () => {
    await reset()
    await setToggleMode('500')
    const html = await (await fetch(`${base()}/`)).text()
    expect(html).toContain('/toggle.js') // the raw stub URL, not an asset path
    let d = await dbg(base())
    expect(d.events.filter((e) => e.key === 'toggle').map((e) => e.type)).toEqual(['error', 'degraded'])
    await dbg(base(), '?clear=1')
    await clearStubLog()
    await (await fetch(`${base()}/`)).text() // inside the window
    d = await dbg(base())
    expect(d.events.filter((e) => e.key === 'toggle').map((e) => e.type)).toEqual(['degraded'])
    expect((await stubLog()).filter((e) => e.path.startsWith('/toggle'))).toHaveLength(0)
    const res = await fetch(`${base()}/__sp/toggle.0000000000000000.js`)
    expect(res.status).toBe(502)
    expect(res.headers.get('x-secondparty-error')).toBe('status') // the stored code (receipt G)
    expect(await res.text()).toBe('')
  })

  it('row 10: a throwing hook never breaks the render', async () => {
    await reset()
    await dbg(base(), '?throwhook=1')
    const res = await fetch(`${base()}/`)
    const html = await res.text()
    await dbg(base(), '?throwhook=0')
    expect(res.status).toBe(200)
    expect(html).toMatch(assetRe('ok'))
  })

  it('receipt A: revalidation past ttl sends If-None-Match and reuses the 304', async () => {
    await reset()
    await (await fetch(`${base()}/`)).text()
    await sleep((TTL + 0.3) * 1000)
    await dbg(base(), '?clear=1')
    await clearStubLog()
    await (await fetch(`${base()}/`)).text()
    const d = await dbg(base())
    const okFetch = d.events.find((e) => e.key === 'ok' && e.type === 'fetch')
    expect(okFetch?.status).toBe(304)
    const log = await stubLog()
    expect(log.find((e) => e.path === '/ok.js')?.ifNoneMatch).toBeDefined()
  })

  it('receipt B: timeout degrades the /slow render with code timeout', async () => {
    await reset()
    const html = await (await fetch(`${base()}/slow`)).text()
    expect(html).toContain('data-degraded="true"')
    expect(html).toContain('/slow.js') // vendor URL emitted
    const d = await dbg(base())
    expect(d.events.filter((e) => e.key === 'slow' && e.type === 'error')[0]?.code).toBe('timeout')
  })

  it('receipt G: content_type fault degrades the /err render', async () => {
    await reset()
    const html = await (await fetch(`${base()}/err`)).text()
    expect(html).toContain('data-degraded="true"')
    const d = await dbg(base())
    expect(d.events.filter((e) => e.key === 'badct' && e.type === 'error')[0]?.code).toBe('content_type')
  })

  it('receipt D: 5 concurrent cold renders, 4 vendor fetches, 4 fetch + 16 hit (ticket 18)', async () => {
    await reset()
    const pages = await Promise.all(Array.from({ length: 5 }, () => fetch(`${base()}/`).then((r) => r.text())))
    const hashes = new Set(pages.map((p) => p.match(assetRe('ok'))![1]))
    expect(hashes.size).toBe(1) // one hash per key
    expect(await stubLog()).toHaveLength(4)
    const d = await dbg(base())
    expect(d.events.filter((e) => e.type === 'fetch')).toHaveLength(4)
    expect(d.events.filter((e) => e.type === 'hit')).toHaveLength(16)
  })
}
```

`integration/rr-node.test.ts`:

```ts
import { afterAll, beforeAll, describe } from 'vitest'
import { startRrNode, startStub, type App } from './driver.ts'
import type { StubVendor } from '../packages/secondparty/test/stub/vendor.ts'
import { defineRowTests } from './rows.ts'

let stub: StubVendor
let app: App

beforeAll(async () => {
  stub = await startStub()
  app = await startRrNode()
})
afterAll(async () => {
  await app?.kill()
  await stub?.close()
})

describe('rr-node (react-router-serve, port 3100)', () => {
  defineRowTests(() => app)
})
```

**Step 2: Run it**

Run: `pnpm test:integration`
Expected: PASS, 14 tests against the built rr-node app. Fix drift in the fixture or the driver, never by weakening a spec value (the receipt numbers are ticket 18's).

**Step 3: Commit**

```bash
git add integration
git commit -m "test: shared validation-row suite + rr-node integration run"
```

### Task C5: fixtures/rr-workers scaffold

**Files:**
- Create: `fixtures/rr-workers/` — copy every file from `fixtures/rr-node`, then apply the diffs below.
- Create: `fixtures/rr-workers/workers/app.ts`
- Create: `fixtures/rr-workers/app/entry.server.tsx`
- Create: `fixtures/rr-workers/wrangler.jsonc`

**Step 1: Copy and rename**

```bash
cp -R fixtures/rr-node fixtures/rr-workers
rm -rf fixtures/rr-workers/node_modules fixtures/rr-workers/build fixtures/rr-workers/.react-router
```

In `fixtures/rr-workers/package.json`: set `"name": "rr-workers"`, replace the scripts, and add the two devDependencies:

```json
"scripts": {
  "dev": "react-router dev",
  "build": "react-router build",
  "start": "wrangler dev --config build/server/wrangler.json --port 8790",
  "typecheck": "react-router typegen && tsc"
},
```

Add to devDependencies: `"@cloudflare/vite-plugin": "1.54.2", "wrangler": "4.127.1"`.

**Step 2: Workers-specific files**

`vite.config.ts` (replace):

```ts
import { reactRouter } from '@react-router/dev/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), reactRouter()],
  resolve: { alias: { '~': new URL('./app', import.meta.url).pathname } },
})
```

`wrangler.jsonc` (vars baked in: `wrangler dev` reads them; the stub port is fixed at 4567):

```jsonc
{
  "name": "rr-workers-fixture",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "main": "./workers/app.ts",
  "vars": {
    "SP_FIXTURE_DEBUG": "1",
    "SP_STUB_ORIGIN": "http://127.0.0.1:4567"
  },
  "assets": { "directory": "./build/client" },
  "observability": { "enabled": true }
}
```

With `nodejs_compat` and a 2026 compatibility date, workerd populates `process.env` from `vars`, so the fixture code reads env the same way on both targets. If `/__debug` answers 404 under `wrangler dev`, that population failed: check the compatibility date first.

`workers/app.ts` (ticket 14: `getLoadContext` must be a `RouterContextProvider`):

```ts
import { createRequestHandler, RouterContextProvider } from 'react-router'

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

export default {
  fetch(request: Request) {
    return requestHandler(request, new RouterContextProvider())
  },
}
```

`app/entry.server.tsx` — copy verbatim from `.scratch/prototype-14/app/entry.server.tsx` (the web default; RR8 picks the Node pipeable-stream entry when `@react-router/node` is installed, and that entry throws on workerd — ticket 14).

**Step 3: Install, build, typecheck**

```bash
pnpm install
pnpm --filter rr-workers build
pnpm --filter rr-workers typecheck
```

Expected: exits 0; `fixtures/rr-workers/build/server/wrangler.json` exists.

**Step 4: Restore the rr-workers build line in `integration/global-setup.ts`** (if commented out in C3).

**Step 5: Commit**

```bash
git add fixtures/rr-workers integration/global-setup.ts pnpm-lock.yaml
git commit -m "feat: rr-workers fixture (web entry.server, RouterContextProvider, wrangler vars)"
```

### Task C6: rr-workers integration run (row 14 parity)

**Files:**
- Create: `integration/rr-workers.test.ts`

**Step 1: Write the test**

```ts
import { afterAll, beforeAll, describe } from 'vitest'
import { startRrWorkers, startStub, type App } from './driver.ts'
import type { StubVendor } from '../packages/secondparty/test/stub/vendor.ts'
import { defineRowTests } from './rows.ts'

let stub: StubVendor
let app: App

beforeAll(async () => {
  stub = await startStub()
  app = await startRrWorkers()
})
afterAll(async () => {
  await app?.kill()
  await stub?.close()
})

describe('rr-workers (wrangler dev, port 8790) — row 14 parity', () => {
  defineRowTests(() => app)
})
```

**Step 2: Run it**

Run: `pnpm test:integration`
Expected: PASS — the same 14 tests, on workerd with `caches.open('secondparty')` as the cache. Known deviation source: miniflare lacks `caches.delete()`; the fixture resets per key (already handled in `context.ts`).

**Step 3: Commit**

```bash
git add integration/rr-workers.test.ts
git commit -m "test: rr-workers parity run under wrangler dev (spec row 14)"
```

### Task C7: Lighthouse E2E and the execution check (row 13, stub half)

**Files:**
- Create: `integration/cdp.ts`
- Create: `integration/lighthouse.test.ts`

**Step 1: Write the CDP helper (no new dependency; Node has `WebSocket`)**

`integration/cdp.ts`:

```ts
// Minimal CDP client: open a tab, evaluate an expression, close the tab.
// Exists so the execution check needs no puppeteer dependency (overview deviation note).

type Tab = { id: string; webSocketDebuggerUrl: string }

export async function evalInNewTab(chromePort: number, url: string, expression: string, tries = 40): Promise<unknown> {
  const tab = (await (
    await fetch(`http://127.0.0.1:${chromePort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  ).json()) as Tab
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const call = (method: string, params?: object) =>
    new Promise<{ result?: { value?: unknown } }>((resolve, reject) => {
      const msgId = ++id
      const onMessage = (ev: MessageEvent) => {
        const data = JSON.parse(String(ev.data))
        if (data.id === msgId) {
          ws.removeEventListener('message', onMessage)
          data.error ? reject(new Error(data.error.message)) : resolve(data.result)
        }
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  try {
    for (let i = 0; i < tries; i++) {
      const r = await call('Runtime.evaluate', { expression, returnByValue: true })
      const v = r?.result?.value
      if (v !== undefined && v !== null) return v
      await new Promise((r2) => setTimeout(r2, 250))
    }
    return undefined
  } finally {
    ws.close()
    await fetch(`http://127.0.0.1:${chromePort}/json/close/${tab.id}`).catch(() => {})
  }
}
```

**Step 2: Write the failing test**

`integration/lighthouse.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launch, type LaunchedChrome } from 'chrome-launcher'
import lighthouse from 'lighthouse'
import { startRrNode, startStub, type App } from './driver.ts'
import type { StubVendor } from '../packages/secondparty/test/stub/vendor.ts'
import { evalInNewTab } from './cdp.ts'

let stub: StubVendor
let app: App
let chrome: LaunchedChrome

beforeAll(async () => {
  stub = await startStub()
  app = await startRrNode()
  chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox'] })
})
afterAll(async () => {
  chrome?.kill()
  await app?.kill()
  await stub?.close()
})

async function cacheInsightItems(url: string): Promise<Array<{ url?: string }>> {
  const result = await lighthouse(url, {
    port: chrome.port,
    output: 'json',
    onlyAudits: ['cache-insight'], // Lighthouse 13 audit id (ticket 19)
    logLevel: 'error',
  })
  const audit = result!.lhr.audits['cache-insight']!
  const details = audit.details as { items?: Array<{ url?: string }> } | undefined
  return details?.items ?? []
}

describe('row 13 (stub half): Lighthouse cache-insight and execution', () => {
  it('/before flags the raw stub URL', async () => {
    const items = await cacheInsightItems(`${app.base}/before`)
    expect(items.some((i) => String(i.url).includes('127.0.0.1:4567'))).toBe(true)
  })

  it('/ has no /__sp/ item in cache-insight', async () => {
    const items = await cacheInsightItems(`${app.base}/`)
    expect(items.some((i) => String(i.url).includes('/__sp/'))).toBe(false)
  })

  it('the proxied scripts execute: window.__sp holds the stub keys', async () => {
    const value = (await evalInNewTab(
      chrome.port,
      `${app.base}/`,
      'window.__sp && window.__sp.length >= 3 ? window.__sp : null',
    )) as Array<{ key: string }> | undefined
    expect(value).toBeDefined()
    const keys = new Set(value!.map((v) => v.key))
    expect(keys.has('ok')).toBe(true)
    expect(keys.has('rotate')).toBe(true)
    expect(keys.has('toggle')).toBe(true)
  })
})
```

**Step 3: Run it**

Run: `pnpm test:integration`
Expected: PASS. If `cache-insight` returns no items on `/before`, print `Object.keys(lhr.audits)` and check the audit id against the installed Lighthouse — the id was verified as `cache-insight` on Lighthouse 13 (ticket 19); do not silently switch audits.

**Step 4: Commit**

```bash
git add integration/cdp.ts integration/lighthouse.test.ts
git commit -m "test: Lighthouse cache-insight E2E and CDP execution check (row 13)"
```

### Task C8: extend push CI to I and E

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Append the steps**

```yaml
      - run: pnpm --filter rr-node build
      - run: pnpm --filter rr-workers build
      - run: SP_SKIP_FIXTURE_BUILD=1 pnpm test:integration
```

`ubuntu-latest` ships Chrome; `wrangler dev` needs no account (ticket 19).

**Step 2: Run the full local equivalent and time it**

```bash
time (pnpm --filter secondparty build && pnpm --filter secondparty test:types && pnpm --filter secondparty test && pnpm --filter rr-node build && pnpm --filter rr-workers build && SP_SKIP_FIXTURE_BUILD=1 pnpm test:integration)
```

Expected: exits 0. Note the wall time; the CI budget is 3-4 minutes (ticket 19). If far over, report at the checkpoint — do not cut cases.

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add integration and Lighthouse levels to the push workflow"
```

### Task C9: plan checkpoint

**CHECKPOINT — stop and review before plan D.** Report: the three integration suites' pass counts and times, the receipt D numbers seen (must be 4 vendor fetches, 4 `fetch`, 16 `hit` on both fixtures), and any deviation added beyond the overview's list.
