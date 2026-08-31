import { inject } from 'vitest'
import { createMemoryCache, defineSecondparty } from '../src/index.ts'
import type { CacheLike, Entry, SecondpartyEvent, SecondpartyOptions } from '../src/index.ts'

export const stubOrigin = () => `http://127.0.0.1:${inject('stubPort')}`
export const deadOrigin = () => `http://127.0.0.1:${inject('deadPort')}`

// Fresh cache per test. On workerd: a new named cache per call, because miniflare
// lacks caches.delete and cache objects must never be identity-compared (ticket 18).
export async function freshCache(): Promise<CacheLike> {
  const c = (globalThis as { caches?: { open?: (name: string) => Promise<unknown> } }).caches
  if (c?.open) return (await c.open(`sp-test-${crypto.randomUUID()}`)) as CacheLike
  return createMemoryCache()
}

// One config + collected events + one cache per test. A fresh config means a fresh
// single-flight map and no cross-test negative records.
export async function makeSp<const T extends Record<string, Entry>>(
  entries: SecondpartyOptions<T>['entries'],
  opts: Omit<SecondpartyOptions<T>, 'entries' | 'onEvent'> = {},
) {
  const events: SecondpartyEvent[] = []
  const sp = defineSecondparty({ ...opts, entries, onEvent: (e) => events.push(e) })
  return { ...sp, events, cache: await freshCache() }
}

export const evs = (events: SecondpartyEvent[]) => events.map((e) => `${e.key}:${e.type}:${e.site}`)

export const stubLog = async (): Promise<
  Array<{ method: string; path: string; ifNoneMatch?: string; userAgent?: string; cookie?: string }>
> =>
  (await fetch(`${stubOrigin()}/__log`)).json() as Promise<
    Array<{ method: string; path: string; ifNoneMatch?: string; userAgent?: string; cookie?: string }>
  >

export const clearStubLog = async () => {
  await fetch(`${stubOrigin()}/__log`, { method: 'DELETE' })
}

export const setToggleMode = async (mode: 'ok' | '500') => {
  await fetch(`${stubOrigin()}/__mode?mode=${mode}`, { method: 'POST' })
}
