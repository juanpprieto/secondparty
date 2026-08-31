import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStubLog, makeSp, stubLog, stubOrigin } from './helpers.ts'

beforeEach(async () => {
  vi.useRealTimers()
  await clearStubLog()
})

describe('entry function: cold fetch (row 1)', () => {
  it('fetches, stores, returns the asset path, emits fetch', async () => {
    const { entries, events, cache } = await makeSp({ ok: { url: `${stubOrigin()}/ok.js` } })
    const r = await entries.ok({ cache })
    expect(r.degraded).toBe(false)
    expect(r.url).toMatch(/^\/__sp\/ok\.[0-9a-f]{16}\.js$/)
    expect(events).toEqual([
      expect.objectContaining({ type: 'fetch', key: 'ok', site: 'render', status: 200 }),
    ])
    const log = await stubLog()
    expect(log).toHaveLength(1)
    expect(log[0]!.userAgent).toMatch(/^secondparty\//) // fixed UA, no visitor headers
    expect(log[0]!.cookie).toBeUndefined()
    expect(log[0]!.ifNoneMatch).toBeUndefined()
  })

  it('honors a custom prefix when building the asset path', async () => {
    const { entries, cache } = await makeSp({ ok: { url: `${stubOrigin()}/ok.js` } }, { prefix: '/assets/sp/' })
    const r = await entries.ok({ cache })
    expect(r.url).toMatch(/^\/assets\/sp\/ok\.[0-9a-f]{16}\.js$/)
  })
})

describe('entry function: warm hit (row 2)', () => {
  it('serves a fresh record without a vendor request', async () => {
    const { entries, events, cache } = await makeSp({ ok: { url: `${stubOrigin()}/ok.js` } })
    const first = await entries.ok({ cache })
    await clearStubLog()
    const second = await entries.ok({ cache })
    expect(second.url).toBe(first.url)
    expect(await stubLog()).toHaveLength(0) // witness: the stub log, never a core counter
    expect(events.at(-1)).toMatchObject({ type: 'hit', key: 'ok', site: 'render' })
  })
})

describe('extension map (ticket 07 / ticket 12)', () => {
  it.each([
    ['/ok.css', 'css'],
    ['/ok.woff2', 'woff2'],
    ['/ok.json', 'json'],
    ['/xjs.js', 'js'],
    ['/noext', 'js'],
  ])('%s maps to .%s', async (route, ext) => {
    const { entries, cache } = await makeSp({ e: { url: `${stubOrigin()}${route}` } })
    const r = await entries.e({ cache })
    expect(r.degraded).toBe(false)
    expect(r.url.endsWith(`.${ext}`)).toBe(true)
  })

  it('follows a redirect and hashes the final body (ticket 12.3)', async () => {
    const a = await makeSp({ e: { url: `${stubOrigin()}/redirect.js` } })
    const b = await makeSp({ e: { url: `${stubOrigin()}/ok.js` } })
    const ra = await a.entries.e({ cache: a.cache })
    const rb = await b.entries.e({ cache: b.cache })
    expect(ra.url.split('.')[1]).toBe(rb.url.split('.')[1]) // same 16-hex hash
  })
})

describe('revalidation past ttl (ticket 05, receipt A)', () => {
  it('sends If-None-Match, takes the 304, keeps the hash', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }) // ticket 19: fake Date only; timers stay real
    const { entries, events, cache } = await makeSp({ ok: { url: `${stubOrigin()}/ok.js`, ttl: 60 } })
    const first = await entries.ok({ cache })
    await clearStubLog()
    vi.setSystemTime(Date.now() + 61_000)
    const second = await entries.ok({ cache })
    expect(second.url).toBe(first.url)
    const log = await stubLog()
    expect(log).toHaveLength(1)
    expect(log[0]!.ifNoneMatch).toBeDefined()
    expect(events.at(-1)).toMatchObject({ type: 'fetch', status: 304 })
  })

  it('takes new bytes and a new hash when the body rotates (ticket 07)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { entries, cache } = await makeSp({ r: { url: `${stubOrigin()}/rotate.js`, ttl: 60 } })
    const first = await entries.r({ cache })
    vi.setSystemTime(Date.now() + 61_000)
    const second = await entries.r({ cache })
    expect(second.url).not.toBe(first.url)
    expect(second.url).toMatch(/^\/__sp\/r\.[0-9a-f]{16}\.js$/)
  })
})
