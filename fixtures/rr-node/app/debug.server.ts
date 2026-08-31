// Fixture-only. Captures onEvent output for the integration driver (SP_FIXTURE_DEBUG=1)
// or prints the README's JSON-lines recipe otherwise. Never a core feature (ticket 19 §4).
import type { SecondpartyEvent } from 'secondparty'

export type FlatEvent = { type: string; key: string; site: string; hash?: string; status?: number; code?: string }
export const state: { events: FlatEvent[]; throwHook: boolean } = { events: [], throwHook: false }

export function record(e: SecondpartyEvent) {
  if (state.throwHook) throw new Error('hook fault (row 10)')
  const flat: FlatEvent = {
    type: e.type,
    key: e.key,
    site: e.site,
    ...('hash' in e ? { hash: e.hash } : {}),
    ...('status' in e ? { status: e.status } : {}),
    ...('error' in e ? { code: e.error.code } : {}),
  }
  if (process.env.SP_FIXTURE_DEBUG === '1') state.events.push(flat)
  else console.log(JSON.stringify({ sp: flat.type, key: flat.key, site: flat.site, hash: flat.hash, status: flat.status, code: flat.code }))
}
