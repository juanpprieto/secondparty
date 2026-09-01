# UAT: fresh Astro app with the packed tarball

Same gate shape as `docs/uat/rr8-link.md`, run against Astro (node adapter,
`output: 'server'`). Record every run as a dated section.

## Runs

### 2026-09-01 — tarball — create-astro minimal + @astrojs/node standalone

App: fresh `create astro` (minimal template) in a separate folder;
`secondparty-0.1.0.tgz` installed; entries `vimeo` (ttl 86400) and `fbevents`;
only the vimeo script is mounted.

Findings that changed the README's Astro example:

1. Files under `src/pages/` that start with `_` never route. The endpoint at
   `src/pages/__sp/[...path].ts` built cleanly and answered 404 — same
   private-prefix defect as Next.js. Fix: `prefix: '/sp/'` in the config,
   endpoint at `src/pages/sp/[...path].ts`.
2. `<script src={url} async>` passes through untouched: a dynamic attribute keeps
   the tag out of Astro's script bundling, so no `is:inline` is needed.
3. No cache duplication: Astro's single server bundle shares one
   `createMemoryCache()`. The log showed one `{"sp":"fetch"}`, then only hits —
   no `globalThis` workaround needed, unlike Next.js.

| Check | Result | Evidence |
|---|---|---|
| types/build | pass | `astro build` clean (vite type-checks the endpoint) |
| render | pass | `<script src="/sp/vimeo.718e1ff73387fc5f.js" async>` in dev and prod (port 3007) |
| current hash | pass | 200; `cache-control: public, max-age=31536000, s-maxage=31536000, immutable`; `etag`; `x-secondparty-*` headers |
| If-None-Match | pass | 304 |
| unknown key | pass | 404; `no-store` |
| vendor effect | pass | `window.Vimeo` is an object; script loads from localhost only |
| warm serve | pass | prod stdout: one `{"sp":"fetch"}`, then only `{"sp":"hit"}` |

Gate result: **pass**, with finding 1 folded into the README.
