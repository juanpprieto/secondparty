# UAT: fresh Next.js app with the packed tarball

Same gate shape as `docs/uat/rr8-link.md`, run against Next.js (App Router).
Record every run as a dated section.

## Runs

### 2026-09-01 — tarball — create-next-app scaffold (App Router, TS)

App: fresh `create-next-app` in a separate folder; `secondparty-0.1.0.tgz` installed;
entries `vimeo` (ttl 86400) and `fbevents`; only the vimeo script is mounted.

Findings that changed the README's Next.js example:

1. App Router folders that start with `_` are private and never route. The handler
   at `app/__sp/[...path]/route.ts` silently vanished from the route table. Fix:
   `prefix: '/sp/'` in the config, handler at `app/sp/[...path]/route.ts`.
2. Next bundles the page and the route handler separately. Two bundles held two
   `createMemoryCache()` instances: the log showed two `{"sp":"fetch"}` for one key.
   Fix: park the cache on `globalThis` (`g.__spCache ??= createMemoryCache()`);
   the refetch count dropped to one.
3. The default page prerendered static, which bakes the asset path at build time.
   `export const dynamic = 'force-dynamic'` restores per-request freshness.

| Check | Result | Evidence |
|---|---|---|
| types | pass | `tsc --noEmit` clean |
| render | pass | `<script src="/sp/vimeo.718e1ff73387fc5f.js">` in dev and prod (port 3005) |
| current hash | pass | 200; `cache-control: public, max-age=31536000, s-maxage=31536000, immutable`; `etag`; all `x-secondparty-*` headers |
| If-None-Match | pass | 304 |
| unknown key | pass | 404; `no-store` |
| vendor effect | pass | `window.Vimeo` is an object; script loads from localhost only |
| warm serve | pass | prod stdout after the globalThis fix: one `{"sp":"fetch"}`, then only `{"sp":"hit"}` |

Gate result: **pass**, with the three fixes above folded into the README.
