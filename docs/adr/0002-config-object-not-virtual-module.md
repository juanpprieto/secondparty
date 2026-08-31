# Expose entries from a user config file, not a virtual module

**Status:** Accepted (2026-08-30, with ADR 0001; ticket 14 confirmed the shape)
**Date:** 2026-08-29
**Authors:** jbaz
**Source:** wayfinder ticket 09, `.scratch/secondparty-design/issues/09-build-integration.md`

## Context

ADR 0001 makes each entry a server function that returns `{ url }`. The charting session
assumed app code imports it as `secondparty:<key>`. That specifier needs a bundler plugin
to resolve it and a generated `.d.ts` to type it, because TypeScript forbids
template-literal module names (TS1443) and a wildcard `declare module 'secondparty:*'`
cannot reject unknown keys.

Under the proxy shape the module body is trivial. It binds a key and a vendor URL to
the generic core function. Nothing in it depends on the bundler.

Evidence: `.scratch/secondparty-design/research/02-bundler-matrix.md`,
`09-config-inference.md`.

## Exploration

**unplugin virtual module.** `resolveId`/`load` for `secondparty:<key>` on Vite, Rollup,
Rspack, esbuild, webpack. Rejected: unplugin plus three transitive dependencies,
150 to 250 lines, a `.d.ts` writer that runs inside the dev server, a six-bundler test
matrix, Rspack colon ids unverified, and no Turbopack support. The only gain is the
specifier text.

**CLI codegen.** `npx secondparty sync` writes `secondparty.generated.ts` from the config.
Rejected: a CLI and a build step that emit at build time what TypeScript infers at type
level, plus a stale-file failure mode between a config edit and the next regen.

**Config object, imported by path.** Chosen. See Decision.

## Decision

The user writes one file, `secondparty.config.server.ts`:

```ts
import { defineSecondparty } from 'secondparty'

export const { entries, handle } = defineSecondparty({
  entries: {
    klaviyo: { url: 'https://static.klaviyo.com/onsite/js/klaviyo.js' },
    yotpo: { url: 'https://cdn-widgetsrepository.yotpo.com/v1/loader/x.js' },
  },
})
```

- `defineSecondparty<const T extends Record<string, Entry>>` returns
  `{ entries: { readonly [K in keyof T]: EntryFunction }, handle }`. TypeScript infers one
  typed function per key. Checked with tsc 5.9.3 under `strict`: unknown keys fail to compile.
  `EntryFunction = (ctx: { cache: CacheLike }) => Promise<{ url: string; degraded: boolean }>`; `handle` takes the same context (ticket 14)
  (`degraded` per ticket 12). `CacheLike`
  is structural `{ match, put }`; the DOM `Cache` satisfies it, and Node projects need no
  `lib: dom`. The `entries` parameter type is `T & { [K in keyof T]: Exact<T[K], Entry> }`
  so an excess field in an entry fails to compile. (Ticket 13.)
- App code imports by path: `import { entries } from '~/secondparty.config.server'`,
  then `await entries.klaviyo({ cache })` in a loader or server component.
- The route adapter imports `handle` from the same file. Config and entries share one
  source, so they cannot drift.
- Options are flat: `{ entries, ttl?, staleTtl?, timeout?, prefix?, userAgent? }`, durations
  in seconds. Each entry is `{ url, ttl?, staleTtl?, timeout? }`, object only. `defineSecondparty`
  checks key charset, URL scheme, `ttl > 0`, `staleTtl >= ttl`, and `prefix`, and throws
  one `Error` at module load that lists every failure. No schema library. (Ticket 06.)
- There is no bundler plugin, no codegen, no `.d.ts`, and no `secondparty:` specifier.
- Client-import guard: `defineSecondparty` throws when `typeof document !== 'undefined'`.
  The README shows the per-framework build-time guard: `.server.ts` in React Router 7
  and Remix, `import 'server-only'` in Next.js, `server/utils/` in Nuxt. Astro and plain
  Vite rely on the runtime throw.

Precedent: tRPC, Hono RPC, Drizzle, and Better Auth export typed values from a
user-written file and leave the client guard to the app.

## Consequences

- Works on Vite, Rollup, Rspack, esbuild, webpack, Turbopack, and plain tsc. Next.js on
  Turbopack is in scope.
- The package ships no plugin and depends on no bundler. The test matrix is one tsc run
  plus the framework prototypes.
- Users type a path, not a specifier. Tooling shows the file; jump-to-definition works.
- An Astro or plain-Vite user who imports the config in a client island gets a runtime
  throw on first render, not a build error.
- DOM shims in unit tests (jsdom) trigger the guard. Tests that call entry functions
  run in a Node environment.
- Supersedes the charting-session decision "typed import `secondparty:<key>`".
