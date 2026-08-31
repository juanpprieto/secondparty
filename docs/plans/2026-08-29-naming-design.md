# secondparty — naming decision

Date: 2026-08-29
Status: decided

## Problem

Lighthouse "Use efficient cache lifetimes" flags third-party assets. You cannot set
`Cache-Control` on a vendor origin. The only fix is to serve the asset from your own
origin with a long cache lifetime.

The library pulls third-party assets at build/deploy time, stores local copies, serves
them from the host app's origin, and re-syncs on every build so local copies track the
remote.

## Decision

- **Package**: `secondparty`
- **Tagline**: *Self-host your third parties. Zero drift.*
- **CLI**: `npx secondparty sync` (verb TBD in implementation design)
- **Domain**: `secondparty.dev` (unresolved in DNS on 2026-08-29; confirm with registrar)
- **GitHub**: repo under owner account. Org name `secondparty` is taken.

## Why "second party"

Third-party assets become first-party in delivery but stay vendor-owned in content.
That middle state is the "second party". The name is descriptive with a twist and
owns an unused term in the 1P/3P vocabulary.

Caveat: strictly, "second party" means the counterparty/user; ad-tech uses it for
partner-shared data. Most devs know only 1P/3P, so the tagline carries the explanation.

## Tagline caveat

"Zero drift" is true at deploy time only. Sync runs at build, so local copies can lag
upstream between deploys. Document this in the README as a deliberate trade-off:
you control when vendor changes land.

## Refinement path

1. Tone: descriptive + a twist (over pure descriptive, metaphor, or terse).
2. Root: "second party" middle ground (over "party" wordplay, "first" as action,
   "third → first").
3. Family: literal (over action `secondpartify`, hosting `co-host`, guest `guestparty`).
4. Form: `secondparty` (over `2ndparty`, `second-party`, scoped `@secondparty/*`).
5. Tagline: #3 over "Third-party assets, served first-party, synced every deploy."

## Availability (checked 2026-08-29)

| Name | npm | Notes |
|---|---|---|
| secondparty | free | chosen |
| 2ndparty | free | runner-up |
| second-party | free | |
| secondpartify | free | possible CLI alias |
| firstparty | free | earlier anchor |
| repatriate | free | metaphor option, rejected |
| partytown | taken | Builder.io; avoid "party" wordplay collisions |

npm user/org page checks returned 403 (rate-limited). Verify with `npm org ls secondparty`.

## Rejected

- `repatriate`: strong metaphor, weak searchability.
- `firstparty`: accurate but flat; claims a state the lib only approximates.
- `houseparty` / `partycrasher`: Partytown-adjacent, confusable.
- `thirdless` / `nomorethird`: negative framing.

## Next

- Register `secondparty.dev`, reserve npm name with a `0.0.1` placeholder.
- Brainstorm the implementation design (build plugin vs CLI, manifest format,
  hashing, rewrite strategy, framework adapters).

## Amendment 2026-08-30 (wayfinder ticket 15)

The tagline "Self-host your third parties. Zero drift." is replaced. Under the runtime-proxy shape
(ADR 0001) no vendor bytes live in the repo and freshness is bounded by `ttl`, so both halves were
false. New tagline:

> **Third-party scripts on first-party URLs, cached for a year.**

Package name `secondparty` unchanged. The `npx secondparty sync` CLI line above is void: v1 ships no
CLI (ADR 0002). Source: `.scratch/secondparty-design/issues/15-readme-honesty.md`.
