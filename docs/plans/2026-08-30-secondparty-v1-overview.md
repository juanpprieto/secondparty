# secondparty v1 Implementation Plan — Overview and Index

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement these plans task-by-task, in the order below.

**Goal:** Build `secondparty` v1 from the approved design, so every push-CI case in ticket 19's matrix passes, the spec's 14 validation rows pass on Node, and rows 1-10 and 14 pass on `wrangler dev`.

**Architecture:** One pnpm workspace. `packages/secondparty` holds the core (runtime proxy, entry functions, handler, single flight) built test-first against a synthetic stub vendor. Fixture apps under `fixtures/` prove the integration levels. The design is closed: ADR 0001, ADR 0002, `docs/spec/v1-api.md`, and tickets 15 and 19 are constraints, not options.

**Tech Stack:** TypeScript 5.9 strict, plain `tsc` build (no bundler), vitest with two projects (node + workerd), React Router 8.3.1 fixtures, wrangler, Lighthouse 13, GitHub Actions.

---

## Plan documents, in execution order

| # | Plan | Delivers |
|---|---|---|
| A | [2026-08-30-secondparty-v1-a-workspace-and-core.md](2026-08-30-secondparty-v1-a-workspace-and-core.md) | git init, pnpm workspace, stub vendor, core built test-first on the node vitest project |
| B | [2026-08-30-secondparty-v1-b-types-and-unit-matrix.md](2026-08-30-secondparty-v1-b-types-and-unit-matrix.md) | type tests (`tsc -p`, dom and node-only), workerd vitest project, CI workflow (T + U) |
| C | [2026-08-30-secondparty-v1-c-fixtures-integration-e2e.md](2026-08-30-secondparty-v1-c-fixtures-integration-e2e.md) | fixtures `rr-node` and `rr-workers`, integration driver, Lighthouse E2E, CI (I + E) |
| D | [2026-08-30-secondparty-v1-d-hydrogen-uat-nightly.md](2026-08-30-secondparty-v1-d-hydrogen-uat-nightly.md) | `fixtures/hydrogen` (manual UAT), `docs/uat/` checklists, nightly real-vendor job |
| E | [2026-08-30-secondparty-v1-e-readme-and-metadata.md](2026-08-30-secondparty-v1-e-readme-and-metadata.md) | README from ticket 15's final text, package metadata, LICENSE, final verification |

Each plan ends at a review checkpoint. Do not start the next plan before the checkpoint passes.

## Source documents (read before execution)

1. `docs/spec/v1-api.md` — public API, handler contract, entry-function contract, 14 validation rows. The replication target.
2. `docs/adr/0001-runtime-proxy-serving-shape.md`, `docs/adr/0002-config-object-not-virtual-module.md` — both Accepted.
3. `CONTEXT.md` — glossary. Use its terms: entry, record, hash, asset path, single flight.
4. `.scratch/secondparty-design/issues/19-test-feedback-loop.md` — test plan (levels T/U/I/E/N/M, stub routes, UAT matrix).
5. `.scratch/secondparty-design/issues/15-readme-honesty.md` — the README's final text.
6. Reference code to lift patterns from (throwaway, never merge): `.scratch/prototype-14/` — `sp/index.ts` (working core), `stub/vendor.mjs`, `validate.mjs`, `validate-18.mjs`, app files.

## Rules in force (from the map; they bind every task)

- No publish. `git init` and per-task commits are approved (user decision, 2026-08-30, this plan's approval).
- No new dependency beyond the approved table below. Approval of these plans is the consent.
- No store name or real account id in any committed file: code, spec, README, tests, fixtures, ADRs, plans, `docs/**`. Ids come from `SP_*` env vars. Use fictitious names (`XXXX`, `example-store`) in prose. `.scratch/` is never committed.
- Ports 3000 and 8787 are taken. Fixtures use **3100** (rr-node) and **8790** (rr-workers). The stub vendor uses port 0 (dynamic) in unit tests and **4567** for fixtures.
- Run `source ~/.nvm/nvm.sh` before any shell work in a fresh session.
- Never rewrite vendor bytes. No CLI. No bundler plugin. No vendor bytes in the repo.
- Playwright MCP hangs; use claude-in-chrome for any manual browser check.

## Approved dependencies (all devDependencies or fixture-local; consent = plan approval)

| Where | Package | Version | Why |
|---|---|---|---|
| root | `typescript` | `5.9.3` | build + type tests (ticket 13 checked 5.9) |
| root | `vitest` | `^3.2` (align to the pool's peer range) | unit + integration runner (ticket 19) |
| root | `@types/node` | `^22` | Node 22 globals for `fetch`/`Response` types |
| root | `lighthouse` | `13.4.1` | E2E `cache-insight` audit (ticket 19) |
| root | `chrome-launcher` | `^1` | launches Chrome for Lighthouse and the CDP check (ticket 19) |
| packages/secondparty | `typescript`, `vitest`, `@types/node` | as root | package-local scripts |
| packages/secondparty | `@cloudflare/vitest-pool-workers` | latest (its peer range picks the vitest minor) | workerd unit project (ticket 19) |
| packages/secondparty | `wrangler` | `4.127.1` | required by the workers pool |
| fixtures/rr-node | `react-router`, `@react-router/node`, `@react-router/serve` | `8.3.1` | proven by prototype-14 |
| fixtures/rr-node | `@react-router/dev`, `vite` | `8.3.1`, `^7` | build |
| fixtures/rr-node | `react`, `react-dom`, `isbot` | `^19.2`, `^19.2`, `^5.1` | RR runtime |
| fixtures/rr-node | `@types/react`, `@types/react-dom` | `^19.2` | typecheck |
| fixtures/rr-workers | all of rr-node, plus `@cloudflare/vite-plugin` `1.54.2`, `wrangler` `4.127.1` | | workerd target |
| fixtures/hydrogen | `@shopify/hydrogen` scaffold (whatever `pnpm create @shopify/hydrogen` pins) | latest | manual UAT fixture (ticket 19) |

No runtime dependency anywhere. `secondparty` itself has zero `dependencies`.

## Repository layout after plan E

```
.
├── .github/workflows/ci.yml          # push: T, U, I, E
├── .github/workflows/nightly.yml     # nightly real-vendor job (N)
├── .gitignore
├── CONTEXT.md                        # exists
├── README.md                        # pointer to packages/secondparty/README.md
├── docs/                             # exists: adr/, spec/, plans/; adds uat/
├── integration/                      # I + E level: driver, tests, vitest config
├── package.json                      # private root
├── pnpm-workspace.yaml
├── scripts/nightly.mjs
├── packages/secondparty/             # the package: src/, test/, dist/
└── fixtures/rr-node|rr-workers|hydrogen/
```

## Level map (ticket 19) → plan

| Level | What | Plan |
|---|---|---|
| T | `tsc -p test/types` (dom + node-only) | B |
| U | vitest `node` project | A |
| U | vitest `workerd` project | B |
| I | `rr-node` (port 3100), `rr-workers` (`wrangler dev`, port 8790) | C |
| E | Lighthouse 13 `cache-insight` + execution check | C |
| N | nightly real-vendor fetch-only | D |
| M | manual UAT: Workers preview, Oxygen, vendor table | D (docs), post-v1 runs |

## Success test for the whole effort

1. `pnpm --filter secondparty test:types` passes (T).
2. `pnpm --filter secondparty test` passes: both vitest projects, every U row of ticket 19's matrix (U).
3. `pnpm test:integration` passes: rows 1-10 + receipts A-D, G on `rr-node`; rows 1-9 parity on `rr-workers`; Lighthouse rows (I, E).
4. The CI workflow runs T, U, I, E on push and stays inside the 3-4 minute budget.
5. Spec coverage: rows 1-13 proven on Node (U+I+E+T), rows 1-10 proven on workerd (U workerd + I rr-workers). Row 14 is that parity. Row 13's real-vendor half is level M by design.

## Deviations the plans make from the letter of a source (each one recorded here, none reopens a decision)

- **Stub gains `/toggle.js` + `POST /__mode?mode=ok|500`** on top of ticket 19's route list. Reason: workerd unit tests run inside workerd and cannot stop a Node process, so "vendor down after a warm record" needs a route that starts to fail on command. The stub log stays the witness.
- **Integration rows 8-9 use `/toggle.js` mode `500`, not a killed stub.** Same code path (vendor error), deterministic, no process churn. The asserted error code is `status` there; unit tests cover all four codes.
- **Integration asserts `Content-Type` with `startsWith`**, because `react-router-serve` (express) can append a charset. Recorded per ticket 19 ("express Content-Type charset deviation recorded").
- **Fixture entries point at the stub**, so validation-row receipts use stub keys (`ok`, not `klaviyo`). Ticket 19 already made the stub the witness at every level; real vendors appear only in N and M.
- **The E-level execution check drives Chrome over raw CDP** (Node `WebSocket`, ~50 lines) instead of a new dependency: `window.__sp` proves the proxied script ran (ticket 19's synthetic body exists for this).
- **ADR 0001's "ext from the Content-Type map, then from the vendor URL"**: the spec's handler contract makes a Content-Type outside the map a vendor error, so the URL fallback is dead. The core implements map-only, like the prototype that passed all rows. The spec is the replication target.
