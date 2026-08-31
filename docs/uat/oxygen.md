# UAT: Hydrogen fixture on Oxygen

Manual level M. Run against a dev-store deploy of `fixtures/hydrogen`.

## Deploy

1. `source ~/.nvm/nvm.sh`
2. Set `SP_KLAVIYO_COMPANY_ID` / `SP_YOTPO_LOADER_ID` as Oxygen environment variables
   for the preview environment (Shopify admin or CLI). Never commit ids.
3. `pnpm --filter hydrogen-fixture build` (Hydrogen's own build), then deploy with the
   Shopify CLI (`shopify hydrogen deploy`) against the dev store.

## Reading logs

- Shopify CLI log stream for the dev store shows the JSON-lines `onEvent` output.

## curl -I checklist

Rows 1-6 identical to docs/uat/workers.md. Row 7 becomes:

| # | Case | Command | Expect |
|---|---|---|---|
| 7 | CDN hit | `curl -sI BASE/__sp/<key>.<hash>.<ext>` twice | second response `Oxygen-Full-Page-Cache: Hit` — requires the route's `Oxygen-Cache-Control` line |

Plus:

| # | Case | Command | Expect |
|---|---|---|---|
| 8 | Oxygen-Cache-Control present at origin | first (Miss) response | route sets it from the handler's Cache-Control |
| 9 | Set-Cookie absent | any asset response | a Set-Cookie disables Oxygen CDN caching silently |

## Vendor execution

Same table as docs/uat/workers.md.

## Runs

<!-- One dated section per run; same template as docs/uat/workers.md. -->
