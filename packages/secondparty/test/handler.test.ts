import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStubLog, deadOrigin, makeSp, setToggleMode, stubLog, stubOrigin } from './helpers.ts'

const req = (path: string, init?: RequestInit) => new Request(`https://app.example${path}`, init)

beforeEach(async () => {
  vi.useRealTimers()
  await clearStubLog()
  await setToggleMode('ok')
})

async function warmSp() {
  const sp = await makeSp({ ok: { url: `${stubOrigin()}/ok.js`, ttl: 60 } })
  const r = await sp.entries.ok({ cache: sp.cache })
  return { ...sp, path: r.url, hash: r.url.split('.')[1]! }
}

describe('handler contract (spec table)', () => {
  it('404 no-store on a bad segment or an unknown key, no vendor request (row 6)', async () => {
    const { handle, cache, hash } = await warmSp()
    await clearStubLog()
    for (const p of ['/__sp/ok.nothex.js', `/__sp/nope.${hash}.js`, '/__sp/', '/__sp/ok..js']) {
      const res = await handle(req(p), { cache })
      expect(res.status, p).toBe(404)
      expect(res.headers.get('cache-control'), p).toBe('no-store')
    }
    expect(await stubLog()).toHaveLength(0)
  })

  it('405 with Allow: GET, HEAD on POST (row 7)', async () => {
    const { handle, cache, path } = await warmSp()
    const res = await handle(req(path, { method: 'POST' }), { cache })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('200 immutable with the full header set on a hash match; never Set-Cookie (row 3)', async () => {
    const { handle, cache, path, hash } = await warmSp()
    const res = await handle(req(path, { headers: { cookie: '__session=x' } }), { cache })
    expect(res.status).toBe(200)
    const body = await res.arrayBuffer()
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, s-maxage=31536000, immutable')
    expect(res.headers.get('etag')).toBe(`"${hash}"`)
    expect(res.headers.get('content-type')).toBe('text/javascript') // vendor value verbatim
    expect(res.headers.get('content-length')).toBe(String(body.byteLength))
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('x-secondparty-key')).toBe('ok')
    expect(res.headers.get('x-secondparty-fetched-at')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(res.headers.get('x-secondparty-source')).toBe(`${stubOrigin()}/ok.js`)
    expect(res.headers.get('x-secondparty-vendor-cache-control')).toBe('max-age=1') // stub /ok.js sends one
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('HEAD answers 200 with headers and no body', async () => {
    const { handle, cache, path } = await warmSp()
    const res = await handle(req(path, { method: 'HEAD' }), { cache })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('an old hash serves the current bytes with max-age=<ttl>, no immutable (row 5)', async () => {
    const { handle, cache } = await warmSp()
    const res = await handle(req('/__sp/ok.0000000000000000.js'), { cache })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60')
    expect((await res.text())).toContain('window.__sp')
  })

  it('304 on If-None-Match, W/ stripped, no body (row 4)', async () => {
    const { handle, cache, path, hash } = await warmSp()
    for (const inm of [`"${hash}"`, `W/"${hash}"`]) {
      const res = await handle(req(path, { headers: { 'if-none-match': inm } }), { cache })
      expect(res.status, inm).toBe(304)
      expect(await res.text()).toBe('')
    }
  })

  it('serves stale with X-SecondParty-Stale: 1 on vendor error inside staleTtl (row 8)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const sp = await makeSp({ t: { url: `${stubOrigin()}/toggle.js`, ttl: 60 } })
    const warm = await sp.entries.t({ cache: sp.cache })
    await setToggleMode('500')
    vi.setSystemTime(Date.now() + 61_000)
    const res = await sp.handle(req(warm.url), { cache: sp.cache })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-secondparty-stale')).toBe('1')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60')
  })

  it('502 with X-SecondParty-Error and no-store when no record is usable (row 9)', async () => {
    const cases: Array<[string, string, number | undefined]> = [
      ['status', `${stubOrigin()}/500.js`, undefined],
      ['content_type', `${stubOrigin()}/html.js`, undefined],
      ['network', `${deadOrigin()}/x.js`, undefined],
      ['timeout', `${stubOrigin()}/hang.js`, 0.1],
    ]
    for (const [code, url, timeout] of cases) {
      const { handle, cache } = await makeSp({ e: timeout ? { url, timeout } : { url } })
      const res = await handle(req('/__sp/e.0000000000000000.js'), { cache })
      expect(res.status, code).toBe(502)
      expect(res.headers.get('x-secondparty-error'), code).toBe(code)
      expect(res.headers.get('cache-control'), code).toBe('no-store')
      expect(await res.text()).toBe('')
    }
  })

  it('handler events carry site: handler', async () => {
    const { handle, cache, events, path } = await warmSp()
    const n0 = events.length
    await handle(req(path), { cache })
    expect(events.slice(n0)).toEqual([expect.objectContaining({ type: 'hit', site: 'handler' })])
  })
})
