import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStubLog, deadOrigin, evs, makeSp, setToggleMode, stubLog, stubOrigin } from './helpers.ts'

beforeEach(async () => {
  vi.useRealTimers()
  await clearStubLog()
  await setToggleMode('ok')
})

describe('single flight (ticket 18)', () => {
  it('cold herd: 5 concurrent calls, 1 vendor fetch, 1 fetch + 4 hit, one path (receipt D)', async () => {
    const { entries, events, cache } = await makeSp({ ok: { url: `${stubOrigin()}/slow.js?ms=100` } })
    const results = await Promise.all(Array.from({ length: 5 }, () => entries.ok({ cache })))
    expect(new Set(results.map((r) => r.url)).size).toBe(1)
    expect(results.every((r) => !r.degraded)).toBe(true)
    expect(await stubLog()).toHaveLength(1)
    expect(events.filter((e) => e.type === 'fetch')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'hit')).toHaveLength(4)
  })

  it('stale herd: 1 revalidation with If-None-Match, 4 hit (receipt E)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { entries, events, cache } = await makeSp({ ok: { url: `${stubOrigin()}/ok.js`, ttl: 60 } })
    await entries.ok({ cache })
    await clearStubLog()
    vi.setSystemTime(Date.now() + 61_000)
    const n0 = events.length
    await Promise.all(Array.from({ length: 5 }, () => entries.ok({ cache })))
    const herd = events.slice(n0)
    const log = await stubLog()
    expect(log).toHaveLength(1)
    expect(log[0]!.ifNoneMatch).toBeDefined()
    expect(herd.filter((e) => e.type === 'fetch' && e.status === 304)).toHaveLength(1)
    expect(herd.filter((e) => e.type === 'hit')).toHaveLength(4)
  })

  it('failure herd: 1 error, 5 degraded with one code, then the negative window (receipt F)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { entries, events, cache } = await makeSp({ e: { url: `${deadOrigin()}/ok.js` } })
    const results = await Promise.all(Array.from({ length: 5 }, () => entries.e({ cache })))
    expect(results.every((r) => r.degraded)).toBe(true)
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1) // one fault = one error event
    const degraded = events.filter((e) => e.type === 'degraded')
    expect(degraded).toHaveLength(5)
    expect(new Set(degraded.map((e) => (e.type === 'degraded' ? e.error.code : ''))).size).toBe(1)
    const n0 = events.length
    const again = await entries.e({ cache }) // inside the 30 s window: no attempt
    expect(again.degraded).toBe(true)
    expect(evs(events.slice(n0))).toEqual(['e:degraded:render'])
  })
})
