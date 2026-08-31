# Plan B: Type Tests and Unit Matrix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Plan A must be complete.

**Goal:** Prove the type contract with `tsc` (level T, spec rows 11-12) and run the whole unit suite on both vitest projects: node and workerd (level U, spec row 14's unit half).

**Architecture:** `test/types/` holds compile-only cases checked by two tsconfigs (node-only libs and dom libs; ticket 13). The workerd project runs the same `test/**/*.test.ts` files under `@cloudflare/vitest-pool-workers`; the stub vendor still runs in the Node host via globalSetup, and tests reach it over `127.0.0.1`.

**Tech Stack:** TypeScript 5.9.3, `@cloudflare/vitest-pool-workers`, wrangler 4.127.1, GitHub Actions.

**Before every session:** `source ~/.nvm/nvm.sh`.

---

### Task B1: type-test fixture (level T)

**Files:**
- Create: `packages/secondparty/test/types/cases.ts`
- Create: `packages/secondparty/test/types/cases-dom.ts`
- Create: `packages/secondparty/test/types/tsconfig.node.json`
- Create: `packages/secondparty/test/types/tsconfig.dom.json`

**Step 1: Write the failing check**

Run: `pnpm --filter secondparty test:types`
Expected: FAIL — the tsconfig files do not exist yet.

**Step 2: Write the cases**

`test/types/cases.ts` (compiles under node-only and dom libs):

```ts
// Level T (ticket 13, spec rows 11-12 type half). Compile-only: tsc must exit 0.
// Every @ts-expect-error line asserts that the marked line DOES NOT compile.
import { createMemoryCache, defineSecondparty, SecondpartyError } from '../../src/index.ts'
import type {
  CacheLike,
  Entries,
  Entry,
  EntryContext,
  EntryFunction,
  EntryResult,
  SecondpartyEvent,
  SecondpartyOptions,
} from '../../src/index.ts'

// The spec's consumer shape infers one typed function per key.
const { entries, handle } = defineSecondparty({
  entries: {
    klaviyo: { url: 'https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=XXXX' },
    vimeo: { url: 'https://player.vimeo.com/api/player.js', ttl: 86400 },
  },
  ttl: 3600,
  onEvent: (e: SecondpartyEvent) => void e,
})

// Row 11: an excess entry field fails tsc (Exact constraint).
// @ts-expect-error foo is not part of Entry
defineSecondparty({ entries: { bad: { url: 'https://vendor.example/x.js', foo: 1 } } })

// Unknown keys fail to compile.
// @ts-expect-error nope is not a declared entry
entries.nope

// Entries is readonly.
// @ts-expect-error entry functions cannot be reassigned
entries.klaviyo = entries.vimeo

// The entry function and handler signatures match the spec.
const fn: EntryFunction = entries.klaviyo
const cache: CacheLike = createMemoryCache()
const ctx: EntryContext = { cache }
const result: Promise<EntryResult> = fn(ctx)
const response: Promise<Response> = handle(new Request('https://app.example/__sp/x'), ctx)
void result
void response

// Event union narrows on type.
declare const ev: SecondpartyEvent
if (ev.type === 'fetch') {
  const s: 200 | 304 = ev.status
  void s
}
if (ev.type === 'degraded') {
  const code: 'timeout' | 'status' | 'content_type' | 'network' = ev.error.code
  void code
}

// SecondpartyError fields per spec.
declare const err: SecondpartyError
const key: string = err.key
const status: number | undefined = err.status
void key
void status

// Options and Entries stay exported and usable.
type Opts = SecondpartyOptions<{ a: Entry }>
type Es = Entries<{ a: Entry }>
declare const opts: Opts
declare const es: Es
void opts
void es
```

`test/types/cases-dom.ts` (dom config only):

```ts
// CacheLike is structural: the DOM Cache satisfies it (ticket 13).
import type { CacheLike } from '../../src/index.ts'

declare const domCache: Cache
const c: CacheLike = domCache
void c
```

**Step 3: Write the tsconfigs**

`test/types/tsconfig.node.json` (node-only libs: proves `CacheLike` needs no `lib: dom`):

```json
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "files": ["cases.ts"]
}
```

`test/types/tsconfig.dom.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "files": ["cases.ts", "cases-dom.ts"]
}
```

**Step 4: Run and make sure it passes**

Run: `pnpm --filter secondparty test:types`
Expected: both tsc runs exit 0.

Negative check — make sure the `@ts-expect-error` lines bite: remove the `// @ts-expect-error` above `entries.nope`, run again, expect FAIL, restore the line.

**Step 5: Commit**

```bash
git add packages/secondparty/test/types
git commit -m "test: level T type fixture, node-only and dom tsconfigs (ticket 13)"
```

### Task B2: workerd vitest project (level U on workerd)

**Files:**
- Create: `packages/secondparty/vitest.workerd.config.ts`
- Modify: `packages/secondparty/vitest.config.ts`

**Step 1: Install the pool (approved in the overview)**

```bash
pnpm --filter secondparty add -D @cloudflare/vitest-pool-workers wrangler@4.127.1
```

If pnpm warns about the vitest peer range, change the `vitest` version in `packages/secondparty/package.json` to the newest version the pool supports, and re-run `pnpm install`.

**Step 2: Write the workerd project config**

`vitest.workerd.config.ts`:

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    name: 'workerd',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'], // runs in the Node host; provide/inject crosses into workerd
    testTimeout: 15000,
    poolOptions: {
      workers: {
        miniflare: {
          compatibilityDate: '2026-08-01',
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
  },
})
```

**Step 3: Register the project**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { projects: ['./vitest.node.config.ts', './vitest.workerd.config.ts'] },
})
```

**Step 4: Run the whole suite on both projects**

Run: `pnpm --filter secondparty test`
Expected: PASS — every test file runs twice (project `node` and project `workerd`). On workerd, `freshCache()` returns `caches.open('sp-test-<uuid>')`, so the unit rows run against the real Cache API (ticket 19's `node` + `workerd` U levels).

Known risks and the fix for each:

- A test file imports `node:http` → only `test/global-setup.ts` and `test/stub/*` may import Node built-ins; test files must not.
- Fetch to `127.0.0.1` blocked → check miniflare's local-network access; if blocked, add the documented miniflare option to allow local fetch. Do not mock fetch (ticket 19: no seams).
- Fake `Date` unsupported → ticket 19 checked that the pool fakes `Date`; if a fake-timer test fails only on workerd, read the pool's timer docs before touching the test.

**Step 5: Commit**

```bash
git add packages/secondparty pnpm-lock.yaml
git commit -m "test: run the unit suite on the workerd project (Cache API)"
```

### Task B3: push CI — levels T and U

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Write the workflow**

```yaml
name: ci
on:
  push:
    branches: ['**']

jobs:
  test:
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
      - run: pnpm --filter secondparty test:types
      - run: pnpm --filter secondparty test
      # Plan C appends the integration and Lighthouse steps here.
```

`pnpm/action-setup@v4` reads the version from the root `packageManager` field.

**Step 2: Check the workflow locally as far as possible**

Run the same commands in order:

```bash
pnpm install --frozen-lockfile && pnpm --filter secondparty build && pnpm --filter secondparty test:types && pnpm --filter secondparty test
```

Expected: exits 0. (The workflow itself runs on the first push to a remote; the repo has no remote yet. That is fine — CI proof lands when a remote exists.)

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: push workflow, levels T and U"
```

### Task B4: plan checkpoint

Run: `pnpm --filter secondparty test:types && pnpm --filter secondparty test`
Expected: T passes; U passes on node and workerd.

**CHECKPOINT — stop and review before plan C.** Report: test counts per project, suite time, and any workerd-only fix that was needed (each such fix must not touch `SecondpartyOptions` — no seams, ticket 19).
