import { createMemoryCache, type CacheLike } from 'secondparty'

let memory: CacheLike | undefined
const hasCacheApi = () =>
  typeof caches !== 'undefined' && typeof (caches as { open?: unknown }).open === 'function'

export async function getCache(): Promise<CacheLike> {
  if (hasCacheApi()) return (await caches.open('secondparty')) as unknown as CacheLike
  return (memory ??= createMemoryCache())
}

// Fixture-only reset for the integration driver. workerd lacks caches.delete()
// on miniflare, so delete per key (record keys are core-internal knowledge; fixture-only).
export async function resetCache(keys: string[]): Promise<string> {
  if (hasCacheApi()) {
    const c = await caches.open('secondparty')
    for (const k of keys) await c.delete(`https://secondparty.invalid/${k}`)
    return 'cache-api (per-key delete)'
  }
  memory = createMemoryCache()
  return 'memory'
}

export const runtime = () => (hasCacheApi() ? 'workerd' : 'node')
