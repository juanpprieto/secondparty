import { expect, it } from 'vitest'
import { clearStubLog, dbg, setToggleMode, sleep, stubLog, type App } from './driver.ts'

const TTL = 2 // fixture entries use a short ttl so revalidation tests use real waits
const assetRe = (key: string, ext = 'js') => new RegExp(`/__sp/${key}\\.([0-9a-f]{16})\\.${ext}`)

export function defineRowTests(getApp: () => App) {
  const base = () => getApp().base
  const reset = async () => {
    await dbg(base(), '?reset=1&clear=1')
    await clearStubLog()
    await setToggleMode('ok')
  }

  it('row 1: cold render holds asset paths, 4 fetch events, 4 stub requests', async () => {
    await reset()
    const html = await (await fetch(`${base()}/`)).text()
    for (const key of ['ok', 'rotate', 'toggle']) expect(html).toMatch(assetRe(key))
    expect(html).toMatch(assetRe('css', 'css'))
    const d = await dbg(base())
    const fetches = d.events.filter((e) => e.type === 'fetch')
    expect(fetches).toHaveLength(4)
    expect(fetches.every((e) => e.site === 'render' && e.status === 200)).toBe(true)
    expect(await stubLog()).toHaveLength(4)
  })

  it('row 2: warm render hits, no vendor request', async () => {
    await reset()
    await (await fetch(`${base()}/`)).text()
    await dbg(base(), '?clear=1')
    await clearStubLog()
    const html = await (await fetch(`${base()}/`)).text()
    expect(html).toMatch(assetRe('ok'))
    const d = await dbg(base())
    expect(d.events.filter((e) => e.key === 'ok' || e.key === 'css' || e.key === 'rotate' || e.key === 'toggle').every((e) => e.type === 'hit')).toBe(true)
    expect(await stubLog()).toHaveLength(0)
  })

  it('rows 3 + receipt C: full header set, 1-year cache, no Set-Cookie with a session', async () => {
    await reset()
    const page = await fetch(`${base()}/`)
    const cookie = page.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toBeTruthy() // the session middleware is live on the layout
    const path = (await page.text()).match(assetRe('ok'))![0]
    const res = await fetch(`${base()}${path}`, { headers: { cookie: cookie! } })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, s-maxage=31536000, immutable')
    expect(res.headers.get('content-type')!.startsWith('text/javascript')).toBe(true) // express may add charset
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{16}"$/)
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('x-secondparty-key')).toBe('ok')
    expect(res.headers.get('x-secondparty-fetched-at')).toMatch(/^\d{4}-/)
    expect(res.headers.get('x-secondparty-source')).toContain('/ok.js')
    expect(res.headers.get('x-secondparty-vendor-cache-control')).toBe('max-age=1')
    expect(res.headers.get('set-cookie')).toBeNull()
    // the asset request carried the cookie and the stub never saw one
    const log = await stubLog()
    expect(log.every((e) => e.cookie === undefined)).toBe(true)
  })

  it('row 4: If-None-Match answers 304 with no body', async () => {
    await reset()
    const html = await (await fetch(`${base()}/`)).text()
    const m = html.match(assetRe('ok'))!
    const res = await fetch(`${base()}${m[0]}`, { headers: { 'if-none-match': `"${m[1]}"` } })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
  })

  it('row 5: an old hash serves current bytes with max-age=<ttl>', async () => {
    await reset()
    await (await fetch(`${base()}/`)).text()
    const res = await fetch(`${base()}/__sp/ok.0000000000000000.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(`public, max-age=${TTL}, s-maxage=${TTL}`)
    expect(await res.text()).toContain('window.__sp')
  })

  it('row 6: unknown key answers 404 and no vendor request', async () => {
    await reset()
    await (await fetch(`${base()}/`)).text()
    await clearStubLog()
    const res = await fetch(`${base()}/__sp/nope.0000000000000000.js`)
    expect(res.status).toBe(404)
    expect(await stubLog()).toHaveLength(0)
  })

  it('row 7: POST answers 405 with Allow: GET, HEAD', async () => {
    await reset()
    const html = await (await fetch(`${base()}/`)).text()
    const path = html.match(assetRe('ok'))![0]
    const res = await fetch(`${base()}${path}`, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it('row 8: vendor error past ttl serves stale (error, stale events; X-SecondParty-Stale)', async () => {
    await reset()
    const warmHtml = await (await fetch(`${base()}/`)).text()
    const warmPath = warmHtml.match(assetRe('toggle'))![0]
    await setToggleMode('500')
    await sleep((TTL + 0.3) * 1000)
    await dbg(base(), '?clear=1')
    const html = await (await fetch(`${base()}/`)).text()
    expect(html.match(assetRe('toggle'))![0]).toBe(warmPath) // same record, same hash
    const d = await dbg(base())
    const toggleEvents = d.events.filter((e) => e.key === 'toggle').map((e) => e.type)
    expect(toggleEvents).toEqual(['error', 'stale'])
    const res = await fetch(`${base()}${warmPath}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-secondparty-stale')).toBe('1')
  })

  it('row 9 + G2: vendor error with no record degrades, 30 s window, 502 with the code', async () => {
    await reset()
    await setToggleMode('500')
    const html = await (await fetch(`${base()}/`)).text()
    expect(html).toContain('/toggle.js') // the raw stub URL, not an asset path
    let d = await dbg(base())
    expect(d.events.filter((e) => e.key === 'toggle').map((e) => e.type)).toEqual(['error', 'degraded'])
    await dbg(base(), '?clear=1')
    await clearStubLog()
    await (await fetch(`${base()}/`)).text() // inside the window
    d = await dbg(base())
    expect(d.events.filter((e) => e.key === 'toggle').map((e) => e.type)).toEqual(['degraded'])
    expect((await stubLog()).filter((e) => e.path.startsWith('/toggle'))).toHaveLength(0)
    const res = await fetch(`${base()}/__sp/toggle.0000000000000000.js`)
    expect(res.status).toBe(502)
    expect(res.headers.get('x-secondparty-error')).toBe('status') // the stored code (receipt G)
    expect(await res.text()).toBe('')
  })

  it('row 10: a throwing hook never breaks the render', async () => {
    await reset()
    await dbg(base(), '?throwhook=1')
    const res = await fetch(`${base()}/`)
    const html = await res.text()
    await dbg(base(), '?throwhook=0')
    expect(res.status).toBe(200)
    expect(html).toMatch(assetRe('ok'))
  })

  it('receipt A: revalidation past ttl sends If-None-Match and reuses the 304', async () => {
    await reset()
    await (await fetch(`${base()}/`)).text()
    await sleep((TTL + 0.3) * 1000)
    await dbg(base(), '?clear=1')
    await clearStubLog()
    await (await fetch(`${base()}/`)).text()
    const d = await dbg(base())
    const okFetch = d.events.find((e) => e.key === 'ok' && e.type === 'fetch')
    expect(okFetch?.status).toBe(304)
    const log = await stubLog()
    expect(log.find((e) => e.path === '/ok.js')?.ifNoneMatch).toBeDefined()
  })

  it('receipt B: timeout degrades the /slow render with code timeout', async () => {
    await reset()
    const html = await (await fetch(`${base()}/slow`)).text()
    expect(html).toContain('data-degraded="true"')
    expect(html).toContain('/slow.js') // vendor URL emitted
    const d = await dbg(base())
    expect(d.events.filter((e) => e.key === 'slow' && e.type === 'error')[0]?.code).toBe('timeout')
  })

  it('receipt G: content_type fault degrades the /err render', async () => {
    await reset()
    const html = await (await fetch(`${base()}/err`)).text()
    expect(html).toContain('data-degraded="true"')
    const d = await dbg(base())
    expect(d.events.filter((e) => e.key === 'badct' && e.type === 'error')[0]?.code).toBe('content_type')
  })

  it('receipt D: 5 concurrent cold renders, 4 vendor fetches, 4 fetch + 16 hit', async () => {
    await reset()
    const pages = await Promise.all(Array.from({ length: 5 }, () => fetch(`${base()}/`).then((r) => r.text())))
    const hashes = new Set(pages.map((p) => p.match(assetRe('ok'))![1]))
    expect(hashes.size).toBe(1) // one hash per key
    expect(await stubLog()).toHaveLength(4)
    const d = await dbg(base())
    expect(d.events.filter((e) => e.type === 'fetch')).toHaveLength(4)
    expect(d.events.filter((e) => e.type === 'hit')).toHaveLength(16)
  })
}
