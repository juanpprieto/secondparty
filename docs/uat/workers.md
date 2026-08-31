# UAT: React Router fixture on a Cloudflare Workers preview

Manual level M. Run against a preview deploy of `fixtures/rr-workers`
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

## curl -I checklist

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
| Awin | conversion tag activity | loads, never tracks — do not proxy; listed here to confirm the README claim only |

## Runs

<!-- One dated section per run. Template: -->

### YYYY-MM-DD — <preview URL>

| Check | Result | Evidence |
|---|---|---|
| curl rows 1-7 | | header dumps |
| Cache API warm | | tail excerpt |
| Multi-isolate | | curl dumps |
| Vendors | | table + screenshots |
