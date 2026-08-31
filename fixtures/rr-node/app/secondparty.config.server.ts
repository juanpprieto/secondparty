import { defineSecondparty } from 'secondparty'
import { record } from './debug.server'

const STUB = process.env.SP_STUB_ORIGIN ?? 'http://127.0.0.1:4567'

export const { entries, handle } = defineSecondparty({
  entries: {
    // The four index entries: receipt D expects 4 vendor fetches for 5 concurrent cold renders.
    ok: { url: `${STUB}/ok.js`, ttl: 2, timeout: 2 },
    css: { url: `${STUB}/ok.css`, ttl: 2 },
    rotate: { url: `${STUB}/rotate.js`, ttl: 2 },
    toggle: { url: `${STUB}/toggle.js`, ttl: 2, timeout: 1 },
    // Referenced only by their own routes; they never join the index render.
    slow: { url: `${STUB}/slow.js?ms=3000`, ttl: 2, timeout: 0.5 },
    badct: { url: `${STUB}/html.js`, ttl: 2 },
  },
  onEvent: (e) => record(e),
})
