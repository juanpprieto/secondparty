import { describe, expect, it } from 'vitest'
import { createMemoryCache } from '../src/index.ts'

describe('createMemoryCache (the one Node adapter)', () => {
  it('misses on an unknown key', async () => {
    const cache = createMemoryCache()
    expect(await cache.match('https://secondparty.invalid/none')).toBeUndefined()
  })

  it('round-trips body, status, and headers', async () => {
    const cache = createMemoryCache()
    await cache.put('https://secondparty.invalid/k', new Response('abc', { headers: { 'x-sp-hash': 'h' } }))
    const res = await cache.match('https://secondparty.invalid/k')
    expect(res!.headers.get('x-sp-hash')).toBe('h')
    expect(await res!.text()).toBe('abc')
  })

  it('serves a fresh body on every match', async () => {
    const cache = createMemoryCache()
    await cache.put('k', new Response('abc'))
    const a = await cache.match('k')
    await a!.arrayBuffer()
    const b = await cache.match('k')
    expect(await b!.text()).toBe('abc')
  })

  it('accepts Request objects as keys', async () => {
    const cache = createMemoryCache()
    await cache.put(new Request('https://x.example/a'), new Response('1'))
    const res = await cache.match('https://x.example/a')
    expect(await res!.text()).toBe('1')
  })
})
