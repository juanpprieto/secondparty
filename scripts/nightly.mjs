// Level N: fetch real vendors server-side through the built core.
// No browser: no pageview reaches any store account. Account-bound ids come from
// SP_* env vars and skip with a logged notice when absent. Asserts, per entry:
// not degraded, no error event, hash stable within the run. Logs whether the vendor
// revalidated with 304 (public CDNs sometimes rotate ETags; that alone never fails the run).
import { createMemoryCache, defineSecondparty } from '../packages/secondparty/dist/index.js'

const entries = {
  fbevents: { url: 'https://connect.facebook.net/en_US/fbevents.js' },
  vimeo: { url: 'https://player.vimeo.com/api/player.js' },
}
const skipped = []
const { SP_KLAVIYO_COMPANY_ID, SP_YOTPO_LOADER_ID, SP_AWIN_AID, SP_SHOP_DOMAIN } = process.env
if (SP_KLAVIYO_COMPANY_ID) {
  entries.klaviyo = { url: `https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=${SP_KLAVIYO_COMPANY_ID}` }
} else skipped.push('klaviyo (SP_KLAVIYO_COMPANY_ID unset)')
if (SP_YOTPO_LOADER_ID) {
  entries.yotpo = { url: `https://cdn-widgetsrepository.yotpo.com/v1/loader/${SP_YOTPO_LOADER_ID}` }
} else skipped.push('yotpo (SP_YOTPO_LOADER_ID unset)')
if (SP_AWIN_AID && SP_SHOP_DOMAIN) {
  entries.awin = {
    url: `https://dr4qe3ddw9y32.cloudfront.net/awin-shopify-integration-code.js?aid=${SP_AWIN_AID}&shop=${SP_SHOP_DOMAIN}`,
  }
} else skipped.push('awin (SP_AWIN_AID or SP_SHOP_DOMAIN unset)')

const events = []
// ttl 0.05 s: the second call revalidates (If-None-Match when the vendor sent an ETag).
const sp = defineSecondparty({ entries, ttl: 0.05, onEvent: (e) => events.push(e) })
const cache = createMemoryCache()
let failed = false

for (const key of Object.keys(entries)) {
  const n0 = events.length
  const first = await sp.entries[key]({ cache })
  await new Promise((r) => setTimeout(r, 100))
  const second = await sp.entries[key]({ cache })
  const evs = events.slice(n0)
  const fetches = evs.filter((e) => e.type === 'fetch')
  const errors = evs.filter((e) => e.type === 'error')
  const hashStable = first.url === second.url
  const ok = !first.degraded && !second.degraded && errors.length === 0 && hashStable
  console.log(
    JSON.stringify({
      key,
      ok,
      degraded: first.degraded || second.degraded,
      statuses: fetches.map((e) => e.status),
      etag304: fetches.some((e) => e.status === 304),
      hashStable,
      errors: errors.map((e) => e.error.code),
    }),
  )
  if (!ok) failed = true
}
for (const s of skipped) console.log(`SKIP: ${s}`)
if (failed) {
  console.error('nightly: FAIL')
  process.exit(1)
}
console.log('nightly: PASS')
