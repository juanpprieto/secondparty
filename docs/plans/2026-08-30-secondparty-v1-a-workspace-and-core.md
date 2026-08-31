# Plan A: Workspace and Core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the git repo and pnpm workspace, then build the `secondparty` core test-first against the stub vendor, on the node vitest project.

**Architecture:** One package, `packages/secondparty`. The core is one module (`src/index.ts`) plus a version constant, lifted from the proven prototype (`.scratch/prototype-14/sp/index.ts`) in TDD increments. Tests never patch `fetch` and never fake timers other than `Date` (ticket 19). The stub vendor's request log is the witness for every "no vendor request" assertion.

**Tech Stack:** pnpm workspace, TypeScript 5.9.3 strict (`exactOptionalPropertyTypes`), plain `tsc` build, vitest (node project only in this plan; plan B adds workerd).

**Before every session:** `source ~/.nvm/nvm.sh`. Work from the repo root `/Users/jbaz/code-jp/2026/secondparty`.

**Reference:** `docs/spec/v1-api.md` is the contract. The prototype is lift material, never merge material.

---

### Task A1: git init and .gitignore

**Files:**
- Create: `.gitignore`

**Step 1: Initialize the repo**

```bash
git init
git branch -m main
```

**Step 2: Write `.gitignore`**

```gitignore
node_modules/
dist/
build/
build-cf/
results/
.wrangler/
.DS_Store
.env
*.local
.scratch/
.claude/
```

`.scratch/` is never committed (map rule). `.claude/` is session config.

**Step 3: Check that git excludes .scratch**

Run: `git status --short`
Expected: `docs/`, `CONTEXT.md`, `.gitignore` appear; `.scratch/` and `.DS_Store` do not.

**Step 4: Commit the existing design docs**

```bash
git add .gitignore CONTEXT.md docs
git commit -m "docs: import approved design (spec, ADRs, naming, v1 plans)"
```

### Task A2: pnpm workspace scaffolding

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`

**Step 1: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - packages/*
  - fixtures/*
```

**Step 2: Write the root `package.json`**

Pin `packageManager` to the installed pnpm: run `pnpm --version` first and use that value.

```json
{
  "name": "secondparty-workspace",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@<version from pnpm --version>",
  "scripts": {
    "test:unit": "pnpm --filter secondparty test",
    "test:types": "pnpm --filter secondparty test:types"
  }
}
```

**Step 3: Check the workspace resolves**

Run: `pnpm install`
Expected: exits 0, writes `pnpm-lock.yaml` (empty workspace is fine).

**Step 4: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "chore: pnpm workspace scaffolding"
```

### Task A3: packages/secondparty scaffold

**Files:**
- Create: `packages/secondparty/package.json`
- Create: `packages/secondparty/tsconfig.json`
- Create: `packages/secondparty/tsconfig.build.json`
- Create: `packages/secondparty/src/version.ts`
- Create: `packages/secondparty/src/index.ts`
- Create: `packages/secondparty/vitest.config.ts`
- Create: `packages/secondparty/vitest.node.config.ts`

**Step 1: Write `packages/secondparty/package.json`**

```json
{
  "name": "secondparty",
  "version": "0.1.0",
  "description": "Third-party scripts on first-party URLs, cached for a year.",
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "test:types": "tsc -p test/types/tsconfig.node.json && tsc -p test/types/tsconfig.dom.json",
    "stub": "node --experimental-strip-types test/stub/serve.ts"
  }
}
```

Plan E finishes the metadata (keywords, repository). No publish.

**Step 2: Write `packages/secondparty/tsconfig.json`**

```json
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

No `dom` lib: `CacheLike` must compile without it (ticket 13). `@types/node` supplies `fetch`, `Response`, `crypto`.

**Step 3: Write `packages/secondparty/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "allowImportingTsExtensions": false,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 4: Write `src/version.ts`**

```ts
// Keep equal to package.json "version".
export const VERSION = '0.1.0'
```

**Step 5: Write an empty `src/index.ts`**

```ts
export {}
```

**Step 6: Write the vitest configs**

`vitest.config.ts` (plan B adds the workerd project to this list):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { projects: ['./vitest.node.config.ts'] },
})
```

`vitest.node.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'node',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 15000,
  },
})
```

**Step 7: Install devDependencies (approved in the overview)**

```bash
pnpm --filter secondparty add -D typescript@5.9.3 vitest@^3.2 @types/node@^22
```

**Step 8: Check tsc and the build**

Run: `pnpm --filter secondparty exec tsc -p tsconfig.json && pnpm --filter secondparty build`
Expected: exits 0; `packages/secondparty/dist/index.js` and `dist/version.js` exist.

**Step 9: Commit**

```bash
git add packages/secondparty pnpm-lock.yaml
git commit -m "chore: scaffold packages/secondparty (tsc build, vitest node project)"
```

### Task A4: stub vendor and global setup

The stub is ticket 19 §1 verbatim, plus two additions recorded in the overview's deviation list: `/toggle.js` and `POST /__mode?mode=ok|500` (workerd unit tests cannot stop a Node process). Bodies are synthetic; never a recorded vendor copy.

**Files:**
- Create: `packages/secondparty/test/stub/vendor.ts`
- Create: `packages/secondparty/test/stub/serve.ts`
- Create: `packages/secondparty/test/global-setup.ts`
- Test: `packages/secondparty/test/stub.test.ts`

**Step 1: Write the failing test**

`test/stub.test.ts`:

```ts
import { describe, expect, inject, it } from 'vitest'

const origin = () => `http://127.0.0.1:${inject('stubPort')}`

describe('stub vendor', () => {
  it('serves /ok.js with ETag, Cache-Control, and the synthetic body', async () => {
    const res = await fetch(`${origin()}/ok.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript')
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{16}"$/)
    expect(res.headers.get('cache-control')).toBe('max-age=1')
    expect(await res.text()).toContain("window.__sp")
  })

  it('answers 304 on a matching If-None-Match', async () => {
    const first = await fetch(`${origin()}/ok.js`)
    const etag = first.headers.get('etag')!
    const res = await fetch(`${origin()}/ok.js`, { headers: { 'if-none-match': etag } })
    expect(res.status).toBe(304)
  })

  it('logs requests and clears the log on DELETE /__log', async () => {
    await fetch(`${origin()}/__log`, { method: 'DELETE' })
    await fetch(`${origin()}/ok.css`)
    let log = await (await fetch(`${origin()}/__log`)).json()
    expect(log).toHaveLength(1)
    expect(log[0].path).toBe('/ok.css')
    await fetch(`${origin()}/__log`, { method: 'DELETE' })
    log = await (await fetch(`${origin()}/__log`)).json()
    expect(log).toHaveLength(0)
  })

  it('rotates /rotate.js on every request', async () => {
    const a = await (await fetch(`${origin()}/rotate.js`)).text()
    const b = await (await fetch(`${origin()}/rotate.js`)).text()
    expect(a).not.toBe(b)
  })

  it('switches /toggle.js between ok and 500 via /__mode', async () => {
    await fetch(`${origin()}/__mode?mode=500`, { method: 'POST' })
    expect((await fetch(`${origin()}/toggle.js`)).status).toBe(500)
    await fetch(`${origin()}/__mode?mode=ok`, { method: 'POST' })
    expect((await fetch(`${origin()}/toggle.js`)).status).toBe(200)
  })

  it('refuses connections on the dead port', async () => {
    await expect(fetch(`http://127.0.0.1:${inject('deadPort')}/ok.js`)).rejects.toThrow()
  })
})
```

**Step 2: Run it to make sure it fails**

Run: `pnpm --filter secondparty exec vitest run test/stub.test.ts`
Expected: FAIL — `Cannot find module './test/global-setup.ts'` (or equivalent).

**Step 3: Write the stub**

`test/stub/vendor.ts`:

```ts
// Stub vendor (ticket 19 §1): synthetic bodies, one route per fault mode, request log as witness.
// Additions over the ticket's route list (overview deviation note): /toggle.js + POST /__mode,
// because workerd unit tests cannot stop this Node process to simulate vendor-down.
import http from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo, Socket } from 'node:net'

export type StubRequest = {
  method: string
  path: string
  ifNoneMatch?: string
  userAgent?: string
  cookie?: string
}
export type StubVendor = { origin: string; port: number; close(): Promise<void> }

const jsBody = (route: string, v: string) =>
  `window.__sp = (window.__sp || []).concat([{ key: '${route}', v: '${v}' }])`
const CSS_BODY = '.sp{color:red}'
const etagOf = (body: string | Buffer) =>
  `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`
// Minimal WOFF2 header: 'wOF2' signature plus padding. The core never parses font bytes.
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(44)])

export function startStubVendor(port = 0): Promise<StubVendor> {
  const log: StubRequest[] = []
  let rotateN = 0
  let toggleMode: 'ok' | '500' = 'ok'
  const sockets = new Set<Socket>()

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const path = url.pathname

    // Control endpoints. Never logged: the log is the vendor-request witness.
    if (path === '/__log') {
      if (req.method === 'DELETE') {
        log.length = 0
        res.writeHead(204)
        return res.end()
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(log))
    }
    if (path === '/__mode') {
      toggleMode = url.searchParams.get('mode') === '500' ? '500' : 'ok'
      res.writeHead(204)
      return res.end()
    }

    const entry: StubRequest = { method: req.method ?? '', path: path + url.search }
    if (req.headers['if-none-match']) entry.ifNoneMatch = String(req.headers['if-none-match'])
    if (req.headers['user-agent']) entry.userAgent = String(req.headers['user-agent'])
    if (req.headers.cookie) entry.cookie = String(req.headers.cookie)
    log.push(entry)

    const okWithEtag = (body: string, contentType: string, extra: Record<string, string> = {}) => {
      const etag = etagOf(body)
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag })
        return res.end()
      }
      res.writeHead(200, { 'content-type': contentType, etag, ...extra })
      res.end(body)
    }

    switch (path) {
      case '/ok.js':
        return okWithEtag(jsBody('ok', '1'), 'text/javascript', { 'cache-control': 'max-age=1' })
      case '/toggle.js':
        if (toggleMode === '500') {
          res.writeHead(500, { 'content-type': 'text/javascript' })
          return res.end('/*500*/')
        }
        return okWithEtag(jsBody('toggle', '1'), 'text/javascript')
      case '/rotate.js': {
        rotateN++
        const body = jsBody('rotate', String(rotateN))
        res.writeHead(200, { 'content-type': 'text/javascript', etag: etagOf(body) })
        return res.end(body)
      }
      case '/ok.css':
        return okWithEtag(CSS_BODY, 'text/css')
      case '/ok.woff2':
        res.writeHead(200, { 'content-type': 'font/woff2' })
        return res.end(WOFF2)
      case '/ok.json':
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end('{}')
      case '/xjs.js':
        res.writeHead(200, { 'content-type': 'application/x-javascript' })
        return res.end(jsBody('xjs', '1'))
      case '/noext':
        res.writeHead(200, { 'content-type': 'text/javascript' })
        return res.end(jsBody('noext', '1'))
      case '/500.js':
        res.writeHead(500, { 'content-type': 'text/javascript' })
        return res.end('/*500*/')
      case '/html.js':
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end('<html>')
      case '/slow.js': {
        const ms = Number(url.searchParams.get('ms') ?? 3000)
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'text/javascript' })
          res.end(jsBody('slow', '1'))
        }, ms)
        return
      }
      case '/hang.js':
        return // never answers; close() destroys the socket
      case '/redirect.js':
        res.writeHead(302, { location: '/ok.js' })
        return res.end()
      case '/octet.woff2':
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        return res.end(WOFF2)
      default:
        res.writeHead(404)
        return res.end()
    }
  })

  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const p = (server.address() as AddressInfo).port
      resolve({
        origin: `http://127.0.0.1:${p}`,
        port: p,
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.destroy()
            server.close(() => r())
          }),
      })
    })
  })
}
```

`test/stub/serve.ts` (fixtures run this via `pnpm stub`; port 4567 because 3000/8787 are taken and the fixtures default to it):

```ts
import { startStubVendor } from './vendor.ts'

const { origin } = await startStubVendor(Number(process.env.SP_STUB_PORT ?? 4567))
console.log(`[stub] listening on ${origin}`)
```

`test/global-setup.ts`:

```ts
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import type { TestProject } from 'vitest/node'
import { startStubVendor } from './stub/vendor.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    stubPort: number
    deadPort: number
  }
}

export default async function setup(project: TestProject) {
  const stub = await startStubVendor()
  // deadPort: opened then closed, so a fetch gets ECONNREFUSED (ticket 19 §1).
  const deadPort = await new Promise<number>((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port
      s.close(() => resolve(p))
    })
  })
  project.provide('stubPort', stub.port)
  project.provide('deadPort', deadPort)
  return () => stub.close()
}
```

**Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter secondparty exec vitest run test/stub.test.ts`
Expected: PASS, 6 tests.

**Step 5: Check the CLI runner**

```bash
cd packages/secondparty && (pnpm stub &) && sleep 1 && curl -s http://127.0.0.1:4567/ok.js && kill %1 2>/dev/null; cd ../..
```

Expected: the synthetic JS body prints. Stop the background stub afterwards (`pkill -f 'test/stub/serve.ts'` if needed).

**Step 6: Commit**

```bash
git add packages/secondparty/test
git commit -m "test: stub vendor with fault routes, request log, global setup"
```

### Task A5: defineSecondparty validation and client guard

**Files:**
- Modify: `packages/secondparty/src/index.ts`
- Test: `packages/secondparty/test/validate.test.ts`

**Step 1: Write the failing test**

`test/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { defineSecondparty } from '../src/index.ts'

const URL_OK = 'https://vendor.example/ok.js'

describe('defineSecondparty validation (spec: six load-time checks)', () => {
  it('accepts a minimal valid config', () => {
    expect(() => defineSecondparty({ entries: { ok: { url: URL_OK } } })).not.toThrow()
  })

  it('throws one Error that lists every failed check', () => {
    let message = ''
    try {
      defineSecondparty({
        prefix: 'sp/',
        entries: {
          'bad key!': { url: URL_OK },
          badurl: { url: 'ftp://x' },
          badttl: { url: URL_OK, ttl: 0 },
          badstale: { url: URL_OK, ttl: 100, staleTtl: 50 },
          badtimeout: { url: URL_OK, timeout: 0 },
        },
      })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('bad key!') // key charset [A-Za-z0-9_-]+
    expect(message).toContain('url') // spec row 11: the throw names `url`
    expect(message).toContain('ttl')
    expect(message).toContain('staleTtl')
    expect(message).toContain('timeout')
    expect(message).toContain('prefix')
  })

  it('checks staleTtl >= ttl after the per-entry merge', () => {
    // default staleTtl 604800; entry ttl above it must fail
    expect(() => defineSecondparty({ entries: { e: { url: URL_OK, ttl: 700000 } } })).toThrow(/staleTtl/)
  })

  it('allows a fractional timeout (spec: seconds, fractions allowed)', () => {
    expect(() => defineSecondparty({ entries: { e: { url: URL_OK, timeout: 0.1 } } })).not.toThrow()
  })

  it('throws when a document global exists (client-import guard, row 12)', () => {
    ;(globalThis as { document?: unknown }).document = {}
    try {
      expect(() => defineSecondparty({ entries: {} })).toThrow(/client/)
    } finally {
      delete (globalThis as { document?: unknown }).document
    }
  })
})
```

**Step 2: Run it to make sure it fails**

Run: `pnpm --filter secondparty exec vitest run test/validate.test.ts`
Expected: FAIL — `defineSecondparty` is not exported.

**Step 3: Write the types, the error class, and the validating skeleton**

Replace `src/index.ts` with:

```ts
import { VERSION } from './version.js'

// Public types (docs/spec/v1-api.md "Public API"; eight types).
export type Entry = { url: string; ttl?: number; staleTtl?: number; timeout?: number }
type Exact<T, Shape> = T & { [K in Exclude<keyof T, keyof Shape>]: never }
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
export type SecondpartyOptions<T extends Record<string, Entry>> = {
  entries: T & { [K in keyof T]: Exact<T[K], Entry> }
  ttl?: number
  staleTtl?: number
  timeout?: number
  prefix?: string
  userAgent?: string
  onEvent?: (event: SecondpartyEvent) => void
}

export class SecondpartyError extends Error {
  code: 'timeout' | 'status' | 'content_type' | 'network'
  key: string
  status?: number
  cause?: unknown
  constructor(
    code: SecondpartyError['code'],
    key: string,
    message: string,
    extra: { status?: number; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'SecondpartyError'
    this.code = code
    this.key = key
    if (extra.status !== undefined) this.status = extra.status
    if (extra.cause !== undefined) this.cause = extra.cause
  }
}

export function defineSecondparty<const T extends Record<string, Entry>>(options: SecondpartyOptions<T>) {
  if (typeof document !== 'undefined') {
    throw new Error('secondparty: config imported in a client module')
  }

  const ttl = options.ttl ?? 3600
  const staleTtl = options.staleTtl ?? 604800
  const timeout = options.timeout ?? 5
  const prefix = options.prefix ?? '/__sp/'
  const userAgent = options.userAgent ?? `secondparty/${VERSION}`

  const failures: string[] = []
  if (!prefix.startsWith('/')) failures.push(`prefix must start with "/": ${prefix}`)
  if (!(ttl > 0)) failures.push('ttl must be > 0')
  if (!(timeout > 0)) failures.push('timeout must be > 0')
  for (const [key, e] of Object.entries(options.entries as Record<string, Entry>)) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) failures.push(`key "${key}": charset [A-Za-z0-9_-]+`)
    let ok = false
    try {
      const u = new URL(e.url)
      ok = u.protocol === 'http:' || u.protocol === 'https:'
    } catch {}
    if (!ok) failures.push(`entry "${key}": url must be http: or https: (${e.url})`)
    const t = e.ttl ?? ttl
    const s = e.staleTtl ?? staleTtl
    const to = e.timeout ?? timeout
    if (!(t > 0)) failures.push(`entry "${key}": ttl must be > 0`)
    if (!(s >= t)) failures.push(`entry "${key}": staleTtl must be >= ttl`)
    if (!(to > 0)) failures.push(`entry "${key}": timeout must be > 0`)
  }
  if (failures.length) throw new Error(`secondparty: invalid config\n- ${failures.join('\n- ')}`)

  // The hook wrapper: a set hook replaces the default warn; hook faults are swallowed (ticket 10).
  const emit = (event: SecondpartyEvent) => {
    if (options.onEvent) {
      try {
        options.onEvent(event)
      } catch {}
      return
    }
    if (event.type === 'error' || event.type === 'degraded') {
      console.warn('[secondparty]', event.key, event.type, event.error.code, event.error.message)
    }
  }
  void emit
  void userAgent

  const entries = Object.fromEntries(
    Object.keys(options.entries).map((key) => [
      key,
      async (_ctx: EntryContext): Promise<EntryResult> => {
        throw new Error(`secondparty: entry "${key}" not implemented yet`)
      },
    ]),
  ) as unknown as Entries<T>

  async function handle(_request: Request, _ctx: EntryContext): Promise<Response> {
    throw new Error('secondparty: handle not implemented yet')
  }

  return { entries, handle }
}
```

**Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter secondparty exec vitest run test/validate.test.ts`
Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add packages/secondparty/src packages/secondparty/test/validate.test.ts
git commit -m "feat: defineSecondparty validation, client guard, public types"
```

### Task A6: createMemoryCache

**Files:**
- Modify: `packages/secondparty/src/index.ts`
- Test: `packages/secondparty/test/memory-cache.test.ts`

**Step 1: Write the failing test**

`test/memory-cache.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createMemoryCache } from '../src/index.ts'

describe('createMemoryCache (the one Node adapter)', () => {
  it('misses on an unknown key', async () => {
    const cache = createMemoryCache()
    expect(await cache.match('https://secondparty.invalid/none')).toBeUndefined()
  })

  it('round-trips body, status, and headers', async () => {
    const cache = createMemoryCache()
    await cache.put('https://secondparty.invalid/k', new Response('abc', { headers: { 'x-sp-hash': 'h' } }))
    const res = await cache.match('https://secondparty.invalid/k')
    expect(res!.headers.get('x-sp-hash')).toBe('h')
    expect(await res!.text()).toBe('abc')
  })

  it('serves a fresh body on every match', async () => {
    const cache = createMemoryCache()
    await cache.put('k', new Response('abc'))
    const a = await cache.match('k')
    await a!.arrayBuffer()
    const b = await cache.match('k')
    expect(await b!.text()).toBe('abc')
  })

  it('accepts Request objects as keys', async () => {
    const cache = createMemoryCache()
    await cache.put(new Request('https://x.example/a'), new Response('1'))
    const res = await cache.match('https://x.example/a')
    expect(await res!.text()).toBe('1')
  })
})
```

**Step 2: Run it to make sure it fails**

Run: `pnpm --filter secondparty exec vitest run test/memory-cache.test.ts`
Expected: FAIL — `createMemoryCache` is not exported.

**Step 3: Implement**

Add to `src/index.ts` (below `SecondpartyError`):

```ts
export function createMemoryCache(): CacheLike {
  const store = new Map<string, { body: Uint8Array; headers: [string, string][]; status: number }>()
  const keyOf = (r: Request | string) => (typeof r === 'string' ? r : r.url)
  return {
    async match(r) {
      const rec = store.get(keyOf(r))
      if (!rec) return undefined
      return new Response(rec.body.slice(), { status: rec.status, headers: rec.headers })
    },
    async put(r, res) {
      const body = new Uint8Array(await res.arrayBuffer())
      store.set(keyOf(r), { body, headers: [...res.headers], status: res.status })
    },
  }
}
```

**Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter secondparty exec vitest run test/memory-cache.test.ts`
Expected: PASS, 4 tests.

**Step 5: Commit**

```bash
git add packages/secondparty/src/index.ts packages/secondparty/test/memory-cache.test.ts
git commit -m "feat: createMemoryCache, the in-memory Node cache adapter"
```

### Task A7: test helpers

Plain setup code, no production change. The helpers give every test a fresh cache and a fresh config, and read the stub log.

**Files:**
- Create: `packages/secondparty/test/helpers.ts`

**Step 1: Write the helpers**

```ts
import { inject } from 'vitest'
import { createMemoryCache, defineSecondparty } from '../src/index.ts'
import type { CacheLike, Entry, SecondpartyEvent, SecondpartyOptions } from '../src/index.ts'

export const stubOrigin = () => `http://127.0.0.1:${inject('stubPort')}`
export const deadOrigin = () => `http://127.0.0.1:${inject('deadPort')}`

// Fresh cache per test. On workerd: a new named cache per call, because miniflare
// lacks caches.delete and cache objects must never be identity-compared (ticket 18).
export async function freshCache(): Promise<CacheLike> {
  const c = (globalThis as { caches?: { open?: (name: string) => Promise<unknown> } }).caches
  if (c?.open) return (await c.open(`sp-test-${crypto.randomUUID()}`)) as CacheLike
  return createMemoryCache()
}

// One config + collected events + one cache per test. A fresh config means a fresh
// single-flight map and no cross-test negative records.
export async function makeSp<const T extends Record<string, Entry>>(
  entries: T,
  opts: Omit<SecondpartyOptions<T>, 'entries' | 'onEvent'> = {},
) {
  const events: SecondpartyEvent[] = []
  const sp = defineSecondparty({ ...opts, entries, onEvent: (e) => events.push(e) })
  return { ...sp, events, cache: await freshCache() }
}

export const evs = (events: SecondpartyEvent[]) => events.map((e) => `${e.key}:${e.type}:${e.site}`)

export const stubLog = async (): Promise<
  Array<{ method: string; path: string; ifNoneMatch?: string; userAgent?: string; cookie?: string }>
> => (await fetch(`${stubOrigin()}/__log`)).json()

export const clearStubLog = async () => {
  await fetch(`${stubOrigin()}/__log`, { method: 'DELETE' })
}

export const setToggleMode = async (mode: 'ok' | '500') => {
  await fetch(`${stubOrigin()}/__mode?mode=${mode}`, { method: 'POST' })
}
```

**Step 2: Check it compiles**

Run: `pnpm --filter secondparty exec tsc -p tsconfig.json`
Expected: exits 0.

**Step 3: Commit**

```bash
git add packages/secondparty/test/helpers.ts
git commit -m "test: shared helpers (fresh cache, event capture, stub log witness)"
```

### Task A8: entry function — cold fetch and warm hit

**Files:**
- Modify: `packages/secondparty/src/index.ts`
- Test: `packages/secondparty/test/entry.test.ts`

**Step 1: Write the failing test**

`test/entry.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStubLog, makeSp, stubLog, stubOrigin } from './helpers.ts'

beforeEach(async () => {
  vi.useRealTimers()
  await clearStubLog()
})

describe('entry function: cold fetch (row 1)', () => {
  it('fetches, stores, returns the asset path, emits fetch', async () => {
    const { entries, events, cache } = await makeSp({ ok: { url: `${stubOrigin()}/ok.js` } })
    const r = await entries.ok({ cache })
    expect(r.degraded).toBe(false)
    expect(r.url).toMatch(/^\/__sp\/ok\.[0-9a-f]{16}\.js$/)
    expect(events).toEqual([
      expect.objectContaining({ type: 'fetch', key: 'ok', site: 'render', status: 200 }),
    ])
    const log = await stubLog()
    expect(log).toHaveLength(1)
    expect(log[0]!.userAgent).toMatch(/^secondparty\//) // fixed UA, no visitor headers
    expect(log[0]!.cookie).toBeUndefined()
    expect(log[0]!.ifNoneMatch).toBeUndefined()
  })

  it('honors a custom prefix when building the asset path', async () => {
    const { entries, cache } = await makeSp({ ok: { url: `${stubOrigin()}/ok.js` } }, { prefix: '/assets/sp/' })
    const r = await entries.ok({ cache })
    expect(r.url).toMatch(/^\/assets\/sp\/ok\.[0-9a-f]{16}\.js$/)
  })
})

describe('entry function: warm hit (row 2)', () => {
  it('serves a fresh record without a vendor request', async () => {
    const { entries, events, cache } = await makeSp({ ok: { url: `${stubOrigin()}/ok.js` } })
    const first = await entries.ok({ cache })
    await clearStubLog()
    const second = await entries.ok({ cache })
    expect(second.url).toBe(first.url)
    expect(await stubLog()).toHaveLength(0) // witness: the stub log, never a core counter
    expect(events.at(-1)).toMatchObject({ type: 'hit', key: 'ok', site: 'render' })
  })
})

describe('extension map (ticket 07 / ticket 12)', () => {
  it.each([
    ['/ok.css', 'css'],
    ['/ok.woff2', 'woff2'],
    ['/ok.json', 'json'],
    ['/xjs.js', 'js'],
    ['/noext', 'js'],
  ])('%s maps to .%s', async (route, ext) => {
    const { entries, cache } = await makeSp({ e: { url: `${stubOrigin()}${route}` } })
    const r = await entries.e({ cache })
    expect(r.degraded).toBe(false)
    expect(r.url.endsWith(`.${ext}`)).toBe(true)
  })

  it('follows a redirect and hashes the final body (ticket 12.3)', async () => {
    const a = await makeSp({ e: { url: `${stubOrigin()}/redirect.js` } })
    const b = await makeSp({ e: { url: `${stubOrigin()}/ok.js` } })
    const ra = await a.entries.e({ cache: a.cache })
    const rb = await b.entries.e({ cache: b.cache })
    expect(ra.url.split('.')[1]).toBe(rb.url.split('.')[1]) // same 16-hex hash
  })
})
```

**Step 2: Run it to make sure it fails**

Run: `pnpm --filter secondparty exec vitest run test/entry.test.ts`
Expected: FAIL — `entry "ok" not implemented yet`.

**Step 3: Implement the record store and the happy-path resolve**

In `src/index.ts`, add module constants below the type block:

```ts
const EXT: Record<string, string> = {
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/x-javascript': 'js',
  'text/css': 'css',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'application/json': 'json',
}
const NEGATIVE_TTL = 30

async function sha256hex16(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(buf)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

type Record_ = {
  bytes: Uint8Array
  contentType: string
  ext: string
  hash: string
  fetchedAt: string
  etag?: string
  vendorCacheControl?: string
}
```

Inside `defineSecondparty`, remove `void emit` and `void userAgent`, and add below `emit`:

```ts
  const cacheKey = (key: string) => `https://secondparty.invalid/${key}`
  const cfg = (key: string) => {
    const e = (options.entries as Record<string, Entry>)[key]!
    return { url: e.url, ttl: e.ttl ?? ttl, staleTtl: e.staleTtl ?? staleTtl, timeout: e.timeout ?? timeout }
  }
  const ageOf = (fetchedAt: string) => (Date.now() - Date.parse(fetchedAt)) / 1000

  async function readRecord(
    cache: CacheLike,
    key: string,
  ): Promise<{ negative: true; fetchedAt: string; code: SecondpartyError['code'] } | Record_ | undefined> {
    const res = await cache.match(cacheKey(key))
    if (!res) return undefined
    const h = res.headers
    if (h.get('x-sp-negative')) {
      return {
        negative: true,
        fetchedAt: h.get('x-sp-fetched-at')!,
        code: (h.get('x-sp-error-code') ?? 'network') as SecondpartyError['code'],
      }
    }
    const rec: Record_ = {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: h.get('content-type')!,
      ext: h.get('x-sp-ext')!,
      hash: h.get('x-sp-hash')!,
      fetchedAt: h.get('x-sp-fetched-at')!,
    }
    const etag = h.get('x-sp-etag')
    if (etag) rec.etag = etag
    const vcc = h.get('x-sp-vendor-cache-control')
    if (vcc) rec.vendorCacheControl = vcc
    return rec
  }

  async function writeRecord(cache: CacheLike, key: string, rec: Record_) {
    const headers: Record<string, string> = {
      'content-type': rec.contentType,
      'x-sp-ext': rec.ext,
      'x-sp-hash': rec.hash,
      'x-sp-fetched-at': rec.fetchedAt,
      // s-maxage keeps the record alive in a real Cache API for the whole retention window.
      'cache-control': `s-maxage=${cfg(key).staleTtl}`,
    }
    if (rec.etag) headers['x-sp-etag'] = rec.etag
    if (rec.vendorCacheControl) headers['x-sp-vendor-cache-control'] = rec.vendorCacheControl
    await cache.put(cacheKey(key), new Response(rec.bytes.slice(), { headers }))
  }

  async function fetchVendor(key: string): Promise<{ status: 200; rec: Record_; durationMs: number }> {
    const c = cfg(key)
    const headers: Record<string, string> = { 'user-agent': userAgent }
    const t0 = Date.now()
    const res = await fetch(c.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(c.timeout * 1000) })
    const durationMs = Date.now() - t0
    const contentType = res.headers.get('content-type') ?? ''
    const mime = contentType.split(';')[0]!.trim().toLowerCase()
    const ext = EXT[mime]!
    const bytes = new Uint8Array(await res.arrayBuffer())
    const rec: Record_ = { bytes, contentType, ext, hash: await sha256hex16(bytes), fetchedAt: new Date().toISOString() }
    const etag = res.headers.get('etag')
    if (etag) rec.etag = etag
    const vcc = res.headers.get('cache-control')
    if (vcc) rec.vendorCacheControl = vcc
    return { status: 200, rec, durationMs }
  }

  type Outcome = { rec?: Record_; stale: boolean; degraded: boolean; error?: SecondpartyError }

  async function resolve(cache: CacheLike, key: string, site: 'render' | 'handler'): Promise<Outcome> {
    const c = cfg(key)
    const existing = await readRecord(cache, key)
    const prev = existing && !('negative' in existing) ? existing : undefined
    if (prev && ageOf(prev.fetchedAt) < c.ttl) {
      emit({ type: 'hit', key, site, hash: prev.hash, fetchedAt: prev.fetchedAt })
      return { rec: prev, stale: false, degraded: false }
    }
    return fetchAndStore(cache, key, site)
  }

  async function fetchAndStore(cache: CacheLike, key: string, site: 'render' | 'handler'): Promise<Outcome> {
    const { status, rec, durationMs } = await fetchVendor(key)
    await writeRecord(cache, key, rec)
    emit({ type: 'fetch', key, site, hash: rec.hash, fetchedAt: rec.fetchedAt, status, durationMs })
    return { rec, stale: false, degraded: false }
  }
```

Replace the placeholder `entries` with:

```ts
  const entries = Object.fromEntries(
    Object.keys(options.entries).map((key) => [
      key,
      async ({ cache }: EntryContext): Promise<EntryResult> => {
        const r = await resolve(cache, key, 'render')
        if (r.degraded || !r.rec) return { url: cfg(key).url, degraded: true }
        return { url: `${prefix}${key}.${r.rec.hash}.${r.rec.ext}`, degraded: false }
      },
    ]),
  ) as unknown as Entries<T>
```

Tasks A9 and A10 extend `fetchVendor`, `resolve`, and `fetchAndStore` with revalidation, error mapping, and the negative record. Do not add them yet.

**Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter secondparty exec vitest run test/entry.test.ts`
Expected: PASS. (`validate`, `memory-cache`, `stub` suites also stay green: run `pnpm --filter secondparty test` to check.)

**Step 5: Commit**

```bash
git add packages/secondparty/src/index.ts packages/secondparty/test/entry.test.ts
git commit -m "feat: cold fetch, record store, warm hit, asset-path building"
```

### Task A9: revalidation past ttl (If-None-Match, 304, rotation)

**Files:**
- Modify: `packages/secondparty/src/index.ts`
- Test: `packages/secondparty/test/entry.test.ts` (append)

**Step 1: Write the failing test**

Append to `test/entry.test.ts`:

```ts
describe('revalidation past ttl (ticket 05, receipt A)', () => {
  it('sends If-None-Match, takes the 304, keeps the hash', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }) // ticket 19: fake Date only; timers stay real
    const { entries, events, cache } = await makeSp({ ok: { url: `${stubOrigin()}/ok.js`, ttl: 60 } })
    const first = await entries.ok({ cache })
    await clearStubLog()
    vi.setSystemTime(Date.now() + 61_000)
    const second = await entries.ok({ cache })
    expect(second.url).toBe(first.url)
    const log = await stubLog()
    expect(log).toHaveLength(1)
    expect(log[0]!.ifNoneMatch).toBeDefined()
    expect(events.at(-1)).toMatchObject({ type: 'fetch', status: 304 })
  })

  it('takes new bytes and a new hash when the body rotates (ticket 07)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { entries, cache } = await makeSp({ r: { url: `${stubOrigin()}/rotate.js`, ttl: 60 } })
    const first = await entries.r({ cache })
    vi.setSystemTime(Date.now() + 61_000)
    const second = await entries.r({ cache })
    expect(second.url).not.toBe(first.url)
    expect(second.url).toMatch(/^\/__sp\/r\.[0-9a-f]{16}\.js$/)
  })
})
```

**Step 2: Run it to make sure it fails**

Run: `pnpm --filter secondparty exec vitest run test/entry.test.ts`
Expected: FAIL — no `If-None-Match` in the stub log, and the second event has `status: 200`, not 304.

**Step 3: Implement**

Change `fetchVendor` to take the previous record and handle 304:

```ts
  async function fetchVendor(key: string, prev?: Record_): Promise<{ status: 200 | 304; rec: Record_; durationMs: number }> {
    const c = cfg(key)
    const headers: Record<string, string> = { 'user-agent': userAgent }
    if (prev?.etag) headers['if-none-match'] = prev.etag
    const t0 = Date.now()
    const res = await fetch(c.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(c.timeout * 1000) })
    const durationMs = Date.now() - t0
    if (res.status === 304 && prev) {
      await res.arrayBuffer().catch(() => {})
      return { status: 304, rec: { ...prev, fetchedAt: new Date().toISOString() }, durationMs }
    }
    const contentType = res.headers.get('content-type') ?? ''
    const mime = contentType.split(';')[0]!.trim().toLowerCase()
    const ext = EXT[mime]!
    const bytes = new Uint8Array(await res.arrayBuffer())
    const rec: Record_ = { bytes, contentType, ext, hash: await sha256hex16(bytes), fetchedAt: new Date().toISOString() }
    const etag = res.headers.get('etag')
    if (etag) rec.etag = etag
    const vcc = res.headers.get('cache-control')
    if (vcc) rec.vendorCacheControl = vcc
    return { status: 200, rec, durationMs }
  }
```

Thread `prev` through: in `resolve`, call `fetchAndStore(cache, key, site, prev)`; in `fetchAndStore`, accept `prev?: Record_` and pass it to `fetchVendor(key, prev)`.

**Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter secondparty exec vitest run test/entry.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/secondparty/src/index.ts packages/secondparty/test/entry.test.ts
git commit -m "feat: ttl revalidation with If-None-Match and 304 reuse"
```

### Task A10: vendor faults — error codes, stale serve, negative record

**Files:**
- Modify: `packages/secondparty/src/index.ts`
- Test: `packages/secondparty/test/faults.test.ts`

**Step 1: Write the failing test**

`test/faults.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStubLog, deadOrigin, evs, makeSp, setToggleMode, stubLog, stubOrigin } from './helpers.ts'

beforeEach(async () => {
  vi.useRealTimers()
  await clearStubLog()
  await setToggleMode('ok')
})

describe('vendor error codes (ticket 12; all four)', () => {
  it.each([
    ['status', '/500.js'],
    ['content_type', '/html.js'],
    ['content_type', '/octet.woff2'], // a font as application/octet-stream is a fault (ticket 15)
  ])('code %s from %s; degraded returns the vendor URL', async (code, route) => {
    const url = `${stubOrigin()}${route}`
    const { entries, events, cache } = await makeSp({ e: { url } })
    const r = await entries.e({ cache })
    expect(r).toEqual({ url, degraded: true })
    expect(evs(events)).toEqual(['e:error:render', 'e:degraded:render'])
    expect(events[0]).toMatchObject({ error: expect.objectContaining({ code }) })
  })

  it('code timeout from /hang.js with timeout 0.1 (receipt B)', async () => {
    const { entries, events, cache } = await makeSp({ e: { url: `${stubOrigin()}/hang.js`, timeout: 0.1 } })
    const r = await entries.e({ cache })
    expect(r.degraded).toBe(true)
    expect(events[0]).toMatchObject({ type: 'error', error: expect.objectContaining({ code: 'timeout' }) })
  })

  it('code network from a refused connection', async () => {
    const { entries, events, cache } = await makeSp({ e: { url: `${deadOrigin()}/ok.js` } })
    const r = await entries.e({ cache })
    expect(r.degraded).toBe(true)
    expect(events[0]).toMatchObject({ type: 'error', error: expect.objectContaining({ code: 'network' }) })
  })

  it('the entry function never throws (spec: entry function contract)', async () => {
    const { entries, cache } = await makeSp({ e: { url: `${deadOrigin()}/ok.js` } })
    await expect(entries.e({ cache })).resolves.toBeDefined()
  })
})

describe('stale serve inside staleTtl (row 8)', () => {
  it('returns the current asset path, degraded false, error then stale events', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { entries, events, cache } = await makeSp({ t: { url: `${stubOrigin()}/toggle.js`, ttl: 60 } })
    const warm = await entries.t({ cache })
    await setToggleMode('500')
    vi.setSystemTime(Date.now() + 61_000) // past ttl, far inside staleTtl (7 d)
    const r = await entries.t({ cache })
    expect(r).toEqual({ url: warm.url, degraded: false })
    expect(evs(events).slice(1)).toEqual(['t:error:render', 't:stale:render'])
  })
})

describe('negative record (row 9, receipt G)', () => {
  it('stores 30 s of degraded that keeps the real code, then refetches', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { entries, events, cache } = await makeSp({ t: { url: `${stubOrigin()}/toggle.js` } })
    await setToggleMode('500')
    const r1 = await entries.t({ cache })
    expect(r1.degraded).toBe(true)
    await clearStubLog()
    const r2 = await entries.t({ cache }) // inside the 30 s window
    expect(r2.degraded).toBe(true)
    expect(await stubLog()).toHaveLength(0) // no vendor fetch inside the window
    expect(events.at(-1)).toMatchObject({
      type: 'degraded',
      error: expect.objectContaining({ code: 'status' }), // the stored code, not a generic one
    })
    await setToggleMode('ok')
    vi.setSystemTime(Date.now() + 31_000) // window over
    const r3 = await entries.t({ cache })
    expect(r3.degraded).toBe(false)
    expect(r3.url).toMatch(/^\/__sp\/t\./)
  })
})
```

**Step 2: Run it to make sure it fails**

Run: `pnpm --filter secondparty exec vitest run test/faults.test.ts`
Expected: FAIL — the fetch rejection propagates out of the entry function.

**Step 3: Implement error mapping, stale serve, and the negative record**

In `fetchVendor`, wrap the `fetch` call and map faults to `SecondpartyError`:

```ts
    let res: Response
    try {
      res = await fetch(c.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(c.timeout * 1000) })
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError'
      throw new SecondpartyError(
        timedOut ? 'timeout' : 'network',
        key,
        timedOut ? `vendor timeout after ${c.timeout}s` : `vendor fetch failed: ${(cause as Error)?.message}`,
        { cause },
      )
    }
```

After the 304 branch, add the status and Content-Type checks (replace the bare `EXT[mime]!` line):

```ts
    if (res.status < 200 || res.status > 299) {
      await res.arrayBuffer().catch(() => {})
      throw new SecondpartyError('status', key, `vendor answered ${res.status}`, { status: res.status })
    }
    const contentType = res.headers.get('content-type') ?? ''
    const mime = contentType.split(';')[0]!.trim().toLowerCase()
    const ext = EXT[mime]
    if (!ext) {
      await res.arrayBuffer().catch(() => {})
      throw new SecondpartyError('content_type', key, `content-type outside the map: ${contentType}`)
    }
```

Add `writeNegative` next to `writeRecord` (the negative record keeps the error code — receipt G bug, ticket 14):

```ts
  async function writeNegative(cache: CacheLike, key: string, code: SecondpartyError['code']) {
    await cache.put(
      cacheKey(key),
      new Response('x', {
        headers: {
          'x-sp-negative': '1',
          'x-sp-error-code': code,
          'x-sp-fetched-at': new Date().toISOString(),
          'cache-control': `s-maxage=${NEGATIVE_TTL}`,
        },
      }),
    )
  }
```

In `resolve`, before the freshness check, honor the negative window:

```ts
    if (existing && 'negative' in existing) {
      if (ageOf(existing.fetchedAt) < NEGATIVE_TTL) {
        const error = new SecondpartyError(existing.code, key, `inside negative window (${existing.code})`)
        emit({ type: 'degraded', key, site, error })
        return { stale: false, degraded: true, error }
      }
    }
```

Wrap `fetchAndStore` in try/catch:

```ts
  async function fetchAndStore(cache: CacheLike, key: string, site: 'render' | 'handler', prev?: Record_): Promise<Outcome> {
    const c = cfg(key)
    try {
      const { status, rec, durationMs } = await fetchVendor(key, prev)
      await writeRecord(cache, key, rec)
      emit({ type: 'fetch', key, site, hash: rec.hash, fetchedAt: rec.fetchedAt, status, durationMs })
      return { rec, stale: false, degraded: false }
    } catch (e) {
      const error = e instanceof SecondpartyError ? e : new SecondpartyError('network', key, String(e), { cause: e })
      emit({ type: 'error', key, site, error })
      if (prev && ageOf(prev.fetchedAt) < c.staleTtl) {
        emit({ type: 'stale', key, site, hash: prev.hash, fetchedAt: prev.fetchedAt })
        return { rec: prev, stale: true, degraded: false, error }
      }
      await writeNegative(cache, key, error.code)
      emit({ type: 'degraded', key, site, error })
      return { stale: false, degraded: true, error }
    }
  }
```

**Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter secondparty exec vitest run test/faults.test.ts`
Expected: PASS. Then run the whole suite: `pnpm --filter secondparty test` — all green.

**Step 5: Commit**

```bash
git add packages/secondparty/src/index.ts packages/secondparty/test/faults.test.ts
git commit -m "feat: vendor fault codes, stale serve, 30s negative record with stored code"
```

### Task A11: single flight

**Files:**
- Modify: `packages/secondparty/src/index.ts`
- Test: `packages/secondparty/test/single-flight.test.ts`

Pattern source: `.scratch/prototype-14/validate-18.mjs` receipts D/E/F.

**Step 1: Write the failing test**

`test/single-flight.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStubLog, deadOrigin, evs, makeSp, setToggleMode, stubLog, stubOrigin } from './helpers.ts'

beforeEach(async () => {
  vi.useRealTimers()
  await clearStubLog()
  await setToggleMode('ok')
})

describe('single flight (ticket 18)', () => {
  it('cold herd: 5 concurrent calls, 1 vendor fetch, 1 fetch + 4 hit, one path (receipt D)', async () => {
    const { entries, events, cache } = await makeSp({ ok: { url: `${stubOrigin()}/slow.js?ms=100` } })
    const results = await Promise.all(Array.from({ length: 5 }, () => entries.ok({ cache })))
    expect(new Set(results.map((r) => r.url)).size).toBe(1)
    expect(results.every((r) => !r.degraded)).toBe(true)
    expect(await stubLog()).toHaveLength(1)
    expect(events.filter((e) => e.type === 'fetch')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(4)
  })

  it('stale herd: 1 revalidation with If-None-Match, 4 hit (receipt E)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { entries, events, cache } = await makeSp({ ok: { url: `${stubOrigin()}/ok.js`, ttl: 60 } })
    await entries.ok({ cache })
    await clearStubLog()
    vi.setSystemTime(Date.now() + 61_000)
    const n0 = events.length
    await Promise.all(Array.from({ length: 5 }, () => entries.ok({ cache })))
    const herd = events.slice(n0)
    const log = await stubLog()
    expect(log).toHaveLength(1)
    expect(log[0]!.ifNoneMatch).toBeDefined()
    expect(herd.filter((e) => e.type === 'fetch' && e.status === 304)).toHaveLength(1)
    expect(herd.filter((e) => e.type === 'hit')).toHaveLength(4)
  })

  it('failure herd: 1 error, 5 degraded with one code, then the negative window (receipt F)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { entries, events, cache } = await makeSp({ e: { url: `${deadOrigin()}/ok.js` } })
    const results = await Promise.all(Array.from({ length: 5 }, () => entries.e({ cache })))
    expect(results.every((r) => r.degraded)).toBe(true)
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1) // one fault = one error event
    const degraded = events.filter((e) => e.type === 'degraded')
    expect(degraded).toHaveLength(5)
    expect(new Set(degraded.map((e) => (e.type === 'degraded' ? e.error.code : ''))).size).toBe(1)
    const n0 = events.length
    const again = await entries.e({ cache }) // inside the 30 s window: no attempt
    expect(again.degraded).toBe(true)
    expect(evs(events.slice(n0))).toEqual(['e:degraded:render'])
  })

  it('mixed sites: one render call and one handler call share one fetch', async () => {
    const { entries, handle, cache } = await makeSp({ ok: { url: `${stubOrigin()}/slow.js?ms=100` } })
    const [r, res] = await Promise.all([
      entries.ok({ cache }),
      handle(new Request('https://app.example/__sp/ok.0000000000000000.js'), { cache }),
    ])
    expect(r.degraded).toBe(false)
    expect(res.status).toBe(200)
    expect(await stubLog()).toHaveLength(1)
  })
})
```

Note: the mixed-sites case needs the handler from task A12. Order the tasks as written and expect this one test to stay red until A12 — or move it: keep the first three tests here and append the mixed-sites test in task A12. **Do the latter: write only the first three tests now.**

**Step 2: Run it to make sure it fails**

Run: `pnpm --filter secondparty exec vitest run test/single-flight.test.ts`
Expected: FAIL — 5 vendor fetches in the stub log, 5 `fetch` events.

**Step 3: Implement the in-flight map**

In `defineSecondparty`, above `resolve`, add:

```ts
  // Ticket 18: one in-flight vendor fetch per key per config, in memory. Keyed per config,
  // never per cache object: workerd caches.open() returns a new object per call.
  const inflight = new Map<string, Promise<Outcome>>()
```

In `resolve`, replace the final `return fetchAndStore(cache, key, site, prev)` with:

```ts
    const leader = inflight.get(key)
    if (leader) {
      const r = await leader
      // Waiters emit only their own outcome event, with the leader's error (ticket 18).
      if (r.degraded || !r.rec) emit({ type: 'degraded', key, site, error: r.error! })
      else if (r.stale) emit({ type: 'stale', key, site, hash: r.rec.hash, fetchedAt: r.rec.fetchedAt })
      else emit({ type: 'hit', key, site, hash: r.rec.hash, fetchedAt: r.rec.fetchedAt })
      return r
    }
    const flight = fetchAndStore(cache, key, site, prev).finally(() => inflight.delete(key))
    inflight.set(key, flight)
    return flight
```

**Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter secondparty exec vitest run test/single-flight.test.ts`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add packages/secondparty/src/index.ts packages/secondparty/test/single-flight.test.ts
git commit -m "feat: single flight per key per config (ticket 18)"
```

### Task A12: the handler

**Files:**
- Modify: `packages/secondparty/src/index.ts`
- Test: `packages/secondparty/test/handler.test.ts`
- Test: `packages/secondparty/test/single-flight.test.ts` (append the mixed-sites test from A11)

**Step 1: Write the failing test**

`test/handler.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStubLog, deadOrigin, makeSp, setToggleMode, stubLog, stubOrigin } from './helpers.ts'

const req = (path: string, init?: RequestInit) => new Request(`https://app.example${path}`, init)

beforeEach(async () => {
  vi.useRealTimers()
  await clearStubLog()
  await setToggleMode('ok')
})

async function warmSp() {
  const sp = await makeSp({ ok: { url: `${stubOrigin()}/ok.js`, ttl: 60 } })
  const r = await sp.entries.ok({ cache: sp.cache })
  return { ...sp, path: r.url, hash: r.url.split('.')[1]! }
}

describe('handler contract (spec table)', () => {
  it('404 no-store on a bad segment or an unknown key, no vendor request (row 6)', async () => {
    const { handle, cache, hash } = await warmSp()
    await clearStubLog()
    for (const p of ['/__sp/ok.nothex.js', `/__sp/nope.${hash}.js`, '/__sp/', '/__sp/ok..js']) {
      const res = await handle(req(p), { cache })
      expect(res.status, p).toBe(404)
      expect(res.headers.get('cache-control'), p).toBe('no-store')
    }
    expect(await stubLog()).toHaveLength(0)
  })

  it('405 with Allow: GET, HEAD on POST (row 7)', async () => {
    const { handle, cache, path } = await warmSp()
    const res = await handle(req(path, { method: 'POST' }), { cache })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('200 immutable with the full header set on a hash match; never Set-Cookie (row 3)', async () => {
    const { handle, cache, path, hash } = await warmSp()
    const res = await handle(req(path, { headers: { cookie: '__session=x' } }), { cache })
    expect(res.status).toBe(200)
    const body = await res.arrayBuffer()
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, s-maxage=31536000, immutable')
    expect(res.headers.get('etag')).toBe(`"${hash}"`)
    expect(res.headers.get('content-type')).toBe('text/javascript') // vendor value verbatim
    expect(res.headers.get('content-length')).toBe(String(body.byteLength))
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('x-secondparty-key')).toBe('ok')
    expect(res.headers.get('x-secondparty-fetched-at')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(res.headers.get('x-secondparty-source')).toBe(`${stubOrigin()}/ok.js`)
    expect(res.headers.get('x-secondparty-vendor-cache-control')).toBe('max-age=1') // stub /ok.js sends one
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('HEAD answers 200 with headers and no body', async () => {
    const { handle, cache, path } = await warmSp()
    const res = await handle(req(path, { method: 'HEAD' }), { cache })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('an old hash serves the current bytes with max-age=<ttl>, no immutable (row 5)', async () => {
    const { handle, cache } = await warmSp()
    const res = await handle(req('/__sp/ok.0000000000000000.js'), { cache })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60')
    expect((await res.text())).toContain('window.__sp')
  })

  it('304 on If-None-Match, W/ stripped, no body (row 4)', async () => {
    const { handle, cache, path, hash } = await warmSp()
    for (const inm of [`"${hash}"`, `W/"${hash}"`]) {
      const res = await handle(req(path, { headers: { 'if-none-match': inm } }), { cache })
      expect(res.status, inm).toBe(304)
      expect(await res.text()).toBe('')
    }
  })

  it('serves stale with X-SecondParty-Stale: 1 on vendor error inside staleTtl (row 8)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const sp = await makeSp({ t: { url: `${stubOrigin()}/toggle.js`, ttl: 60 } })
    const warm = await sp.entries.t({ cache: sp.cache })
    await setToggleMode('500')
    vi.setSystemTime(Date.now() + 61_000)
    const res = await sp.handle(req(warm.url), { cache: sp.cache })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-secondparty-stale')).toBe('1')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60')
  })

  it('502 with X-SecondParty-Error and no-store when no record is usable (row 9)', async () => {
    const cases: Array<[string, string, number | undefined]> = [
      ['status', `${stubOrigin()}/500.js`, undefined],
      ['content_type', `${stubOrigin()}/html.js`, undefined],
      ['network', `${deadOrigin()}/x.js`, undefined],
      ['timeout', `${stubOrigin()}/hang.js`, 0.1],
    ]
    for (const [code, url, timeout] of cases) {
      const { handle, cache } = await makeSp({ e: timeout ? { url, timeout } : { url } })
      const res = await handle(req('/__sp/e.0000000000000000.js'), { cache })
      expect(res.status, code).toBe(502)
      expect(res.headers.get('x-secondparty-error'), code).toBe(code)
      expect(res.headers.get('cache-control'), code).toBe('no-store')
      expect(await res.text()).toBe('')
    }
  })

  it('handler events carry site: handler', async () => {
    const { handle, cache, events, path } = await warmSp()
    const n0 = events.length
    await handle(req(path), { cache })
    expect(events.slice(n0)).toEqual([expect.objectContaining({ type: 'hit', site: 'handler' })])
  })
})
```

Also append to `test/single-flight.test.ts` the mixed-sites test from task A11's listing.

**Step 2: Run it to make sure it fails**

Run: `pnpm --filter secondparty exec vitest run test/handler.test.ts`
Expected: FAIL — `handle not implemented yet`.

**Step 3: Implement the handler**

Add the segment regex next to `EXT`:

```ts
const SEGMENT = /^(?<key>[A-Za-z0-9_-]+)\.(?<hash>[0-9a-f]{16})\.(?<ext>[a-z0-9]+)$/
```

Replace the `handle` placeholder inside `defineSecondparty`:

```ts
  async function handle(request: Request, { cache }: EntryContext): Promise<Response> {
    const noStore = (status: number, headers: Record<string, string> = {}) =>
      new Response(null, { status, headers: { 'cache-control': 'no-store', ...headers } })
    const segment = new URL(request.url).pathname.split('/').pop() ?? ''
    const m = SEGMENT.exec(segment)
    if (!m?.groups) return noStore(404)
    const { key, hash } = m.groups as { key: string; hash: string }
    if (!(key in (options.entries as object))) return noStore(404)
    if (request.method !== 'GET' && request.method !== 'HEAD') return noStore(405, { allow: 'GET, HEAD' })
    const r = await resolve(cache, key, 'handler')
    if (!r.rec) return noStore(502, { 'x-secondparty-error': r.error?.code ?? 'network' })
    const rec = r.rec
    const c = cfg(key)
    const headers = new Headers({
      'content-type': rec.contentType,
      'content-length': String(rec.bytes.byteLength),
      etag: `"${rec.hash}"`,
      vary: 'Accept-Encoding',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      'x-secondparty-key': key,
      'x-secondparty-fetched-at': rec.fetchedAt,
      'x-secondparty-source': c.url,
      'cache-control':
        hash === rec.hash && !r.stale
          ? 'public, max-age=31536000, s-maxage=31536000, immutable'
          : `public, max-age=${c.ttl}, s-maxage=${c.ttl}`,
    })
    if (rec.vendorCacheControl) headers.set('x-secondparty-vendor-cache-control', rec.vendorCacheControl)
    if (r.stale) headers.set('x-secondparty-stale', '1')
    const inm = request.headers.get('if-none-match')
    if (inm && inm.replace(/^W\//, '') === `"${rec.hash}"`) return new Response(null, { status: 304, headers })
    return new Response(request.method === 'HEAD' ? null : rec.bytes.slice(), { status: 200, headers })
  }
```

**Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter secondparty test`
Expected: PASS — the full suite, including the appended mixed-sites test.

**Step 5: Commit**

```bash
git add packages/secondparty/src/index.ts packages/secondparty/test
git commit -m "feat: handler with full header contract, 304, stale, 502"
```

### Task A13: event defaults — console.warn and hook faults

The `emit` wrapper exists since task A5. These tests pin its contract (ticket 10, row 10).

**Files:**
- Test: `packages/secondparty/test/events.test.ts`

**Step 1: Write the test**

`test/events.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineSecondparty } from '../src/index.ts'
import type { SecondpartyEvent } from '../src/index.ts'
import { clearStubLog, deadOrigin, freshCache, stubOrigin } from './helpers.ts'

beforeEach(async () => {
  vi.useRealTimers()
  await clearStubLog()
})

describe('onEvent defaults and faults (ticket 10)', () => {
  it('console.warns once per error and once per degraded when no hook is set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { entries } = defineSecondparty({ entries: { e: { url: `${deadOrigin()}/x.js` } } })
      const r = await entries.e({ cache: await freshCache() })
      expect(r.degraded).toBe(true)
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('a set hook replaces the default warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const seen: SecondpartyEvent[] = []
      const { entries } = defineSecondparty({
        entries: { e: { url: `${deadOrigin()}/x.js` } },
        onEvent: (e) => seen.push(e),
      })
      await entries.e({ cache: await freshCache() })
      expect(seen.map((e) => e.type)).toEqual(['error', 'degraded'])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('a throwing hook is swallowed; the call still succeeds (row 10)', async () => {
    const { entries } = defineSecondparty({
      entries: { ok: { url: `${stubOrigin()}/ok.js` } },
      onEvent: () => {
        throw new Error('hook fault')
      },
    })
    const r = await entries.ok({ cache: await freshCache() })
    expect(r.degraded).toBe(false)
    expect(r.url).toMatch(/^\/__sp\/ok\./)
  })
})
```

**Step 2: Run the tests**

Run: `pnpm --filter secondparty exec vitest run test/events.test.ts`
Expected: PASS at once (the wrapper exists since A5). If any test fails, the wrapper drifted: fix `emit`, not the test.

**Step 3: Commit**

```bash
git add packages/secondparty/test/events.test.ts
git commit -m "test: pin onEvent default warn and hook-fault swallowing"
```

### Task A14: build check and plan checkpoint

**Files:** none new.

**Step 1: Full suite**

Run: `pnpm --filter secondparty test`
Expected: PASS — stub, validate, memory-cache, entry, faults, single-flight, handler, events.

**Step 2: Build and import the artifact**

```bash
pnpm --filter secondparty build
node -e "import('./packages/secondparty/dist/index.js').then((m) => { const sp = m.defineSecondparty({ entries: { a: { url: 'https://vendor.example/a.js' } } }); console.log(typeof sp.entries.a, typeof sp.handle, typeof m.createMemoryCache) })"
```

Expected: `function function function`.

**Step 3: Commit any build-config fix, then tag the checkpoint**

```bash
git add -A && git commit -m "chore: plan A checkpoint - core complete on the node project" --allow-empty
```

**CHECKPOINT — stop and review before plan B.** The core passes every U-level row of ticket 19's matrix on the node project. Report: test count, suite time, any deviation from this plan.
