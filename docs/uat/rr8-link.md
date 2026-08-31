# UAT: fresh React Router 8 app with a linked local build

Pre-publish gate (see `docs/releasing.md`). Prove the built package works in an app
outside this repository, against real vendors, before any `npm publish`.
Record every run as a dated section below the checklist.

Two install modes:

- **`npm link`** — fast iteration; rebuilds in the repo appear in the app at once.
  A link is a symlink to the package folder, so it skips the `files` whitelist.
- **tarball** — `npm pack` output, exactly the 7 files npm ships. The final gate
  run must use the tarball.

## 1. Build and expose the package

```bash
source ~/.nvm/nvm.sh
cd <repo>
pnpm --filter secondparty build
cd packages/secondparty
npm link                    # link mode
npm pack --pack-destination /tmp   # tarball mode -> /tmp/secondparty-0.1.0.tgz
```

## 2. Scaffold the app in a separate folder

```bash
cd <somewhere outside the repo>
npx create-react-router@latest sp-link-test   # accept defaults, npm install
cd sp-link-test
npm link secondparty        # link mode
# or: npm i /tmp/secondparty-0.1.0.tgz        # tarball mode
```

## 3. Wire the quick start

Follow the package README quick start with these files. Entries use vendors that
carry no account id.

`app/secondparty.config.server.ts`

```ts
import { defineSecondparty } from 'secondparty'

export const { entries, handle } = defineSecondparty({
  entries: {
    vimeo: { url: 'https://player.vimeo.com/api/player.js', ttl: 86400 },
    fbevents: { url: 'https://connect.facebook.net/en_US/fbevents.js' },
  },
  onEvent: (e) => console.log(JSON.stringify({ sp: e.type, key: e.key })),
})
```

`app/context.ts`

```ts
import { createMemoryCache } from 'secondparty'
export const cache = createMemoryCache()
```

`app/routes/__sp.$.tsx` (register it in `app/routes.ts`: `route('__sp/*', 'routes/__sp.$.tsx')`)

```ts
import { handle } from '~/secondparty.config.server'
import { cache } from '~/context'
import type { Route } from './+types/__sp.$'

export const loader = ({ request }: Route.LoaderArgs) => handle(request, { cache })
```

Home route: load `const { url } = await entries.vimeo({ cache })`, return it, render
`<script src={loaderData.url} async />`.

## 4. Checks

Dev first (`npm run dev`), then prod (`npm run build && npm run start`). Check both.

| # | Check | Command / place | Expect |
|---|---|---|---|
| 1 | types resolve | `npx tsc --noEmit` after `npx react-router typegen` | no errors from `secondparty` imports |
| 2 | page renders | open `/` | script tag src is `/__sp/vimeo.<hash>.js` |
| 3 | current hash | `curl -sI localhost:PORT/__sp/vimeo.<hash>.js` | 200; `cache-control: public, max-age=31536000, s-maxage=31536000, immutable`; `etag`; `x-secondparty-*` headers |
| 4 | If-None-Match | `curl -sI -H 'If-None-Match: "<hash>"' ...` | 304 |
| 5 | unknown key | `curl -sI localhost:PORT/__sp/nope.<hash>.js` | 404; `no-store` |
| 6 | vendor effect | browser console | `window.Vimeo` defined; `window.fbq` defined |
| 7 | warm serve | reload `/`; app stdout | no second `{"sp":"fetch"}` line inside the `ttl` |
| 8 | tarball parity | repeat 1-7 in tarball mode | same results |

Row 8 is the gate: the tarball run must pass before the first publish.

## Troubleshooting

- Vite refuses the linked symlink: add `resolve: { preserveSymlinks: true }` to
  `vite.config.ts`, or switch to the tarball.
- `Cannot find module 'secondparty'` in SSR: check the app's `node_modules/secondparty`
  exists and holds `dist/`; re-run the link after any `npm install` (installs drop links).

## Runs

### 2026-08-31 — link then tarball — react-router 8 (create-react-router scaffold)

App: fresh `create-react-router` scaffold in a separate folder; entries `vimeo`
(ttl 86400) and `fbevents`; only the vimeo script is mounted on the page.

| Check | Result | Evidence |
|---|---|---|
| 1 types | pass | `tsc --noEmit` clean after one app-layer fix (the scaffold's Welcome component referenced the route loader out of scope; url now passes as a prop — not a package issue) |
| 2 render | pass | `<script src="/__sp/vimeo.718e1ff73387fc5f.js">` in dev (5174) and prod (3105) |
| 3 current hash | pass | 200; `cache-control: public, max-age=31536000, s-maxage=31536000, immutable`; `etag: "718e1ff73387fc5f"`; all `x-secondparty-*` headers; `x-secondparty-vendor-cache-control: public, max-age=1800` captured and ignored |
| 4 If-None-Match | pass | 304 |
| 5 unknown key | pass | 404; `no-store` |
| 6 vendor effect | pass | `window.Vimeo` is an object in dev and prod; the only vimeo network request is the localhost asset path — none to player.vimeo.com. `fbq` undefined: entry declared, script never mounted (expected) |
| 7 warm serve | pass | prod stdout: one `{"sp":"fetch"}` then only `{"sp":"hit"}` across reloads; dev: `fetched-at` constant across hits |
| 8 tarball parity | pass | `npm i secondparty-0.1.0.tgz`; `node_modules/secondparty` = real dir with exactly `dist`, `README.md`, `LICENSE`, `package.json`; rows 1-7 repeated in prod, same hash, same results |

Gate result: **pass**. The app stays in tarball mode; re-run `npm link secondparty`
for iteration.

<!-- One dated section per run. Template: -->

### YYYY-MM-DD — link | tarball — RR version

| Check | Result | Evidence |
|---|---|---|
| rows 1-7 | | dumps / console excerpts |
| row 8 (tarball) | | dumps |
