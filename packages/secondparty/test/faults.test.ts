import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStubLog, deadOrigin, evs, makeSp, setToggleMode, stubLog, stubOrigin } from './helpers.ts'

beforeEach(async () => {
  vi.useRealTimers()
  await clearStubLog()
  await setToggleMode('ok')
})

describe('vendor error codes (ticket 12; all four)', () => {
  it.each([
    ['status', '/500.js'],
    ['content_type', '/html.js'],
    ['content_type', '/octet.woff2'], // a font served as application/octet-stream is a fault
  ])('code %s from %s; degraded returns the vendor URL', async (code, route) => {
    const url = `${stubOrigin()}${route}`
    const { entries, events, cache } = await makeSp({ e: { url } })
    const r = await entries.e({ cache })
    expect(r).toEqual({ url, degraded: true })
    expect(evs(events)).toEqual(['e:error:render', 'e:degraded:render'])
    expect(events[0]).toMatchObject({ error: expect.objectContaining({ code }) })
  })

  it('code timeout from /hang.js with timeout 0.1 (receipt B)', async () => {
    const { entries, events, cache } = await makeSp({ e: { url: `${stubOrigin()}/hang.js`, timeout: 0.1 } })
    const r = await entries.e({ cache })
    expect(r.degraded).toBe(true)
    expect(events[0]).toMatchObject({ type: 'error', error: expect.objectContaining({ code: 'timeout' }) })
  })

  it('code network from a refused connection', async () => {
    const { entries, events, cache } = await makeSp({ e: { url: `${deadOrigin()}/ok.js` } })
    const r = await entries.e({ cache })
    expect(r.degraded).toBe(true)
    expect(events[0]).toMatchObject({ type: 'error', error: expect.objectContaining({ code: 'network' }) })
  })

  it('the entry function never throws (spec: entry function contract)', async () => {
    const { entries, cache } = await makeSp({ e: { url: `${deadOrigin()}/ok.js` } })
    await expect(entries.e({ cache })).resolves.toBeDefined()
  })
})

describe('stale serve inside staleTtl (row 8)', () => {
  it('returns the current asset path, degraded false, error then stale events', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { entries, events, cache } = await makeSp({ t: { url: `${stubOrigin()}/toggle.js`, ttl: 60 } })
    const warm = await entries.t({ cache })
    await setToggleMode('500')
    vi.setSystemTime(Date.now() + 61_000) // past ttl, far inside staleTtl (7 d)
    const r = await entries.t({ cache })
    expect(r).toEqual({ url: warm.url, degraded: false })
    expect(evs(events).slice(1)).toEqual(['t:error:render', 't:stale:render'])
  })
})

describe('negative record (row 9, receipt G)', () => {
  it('stores 30 s of degraded that keeps the real code, then refetches', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { entries, events, cache } = await makeSp({ t: { url: `${stubOrigin()}/toggle.js` } })
    await setToggleMode('500')
    const r1 = await entries.t({ cache })
    expect(r1.degraded).toBe(true)
    await clearStubLog()
    const r2 = await entries.t({ cache }) // inside the 30 s window
    expect(r2.degraded).toBe(true)
    expect(await stubLog()).toHaveLength(0) // no vendor fetch inside the window
    expect(events.at(-1)).toMatchObject({
      type: 'degraded',
      error: expect.objectContaining({ code: 'status' }), // the stored code, not a generic one
    })
    await setToggleMode('ok')
    vi.setSystemTime(Date.now() + 31_000) // window over
    const r3 = await entries.t({ cache })
    expect(r3.degraded).toBe(false)
    expect(r3.url).toMatch(/^\/__sp\/t\./)
  })
})
