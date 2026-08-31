import { describe, expect, inject, it } from 'vitest'

const origin = () => `http://127.0.0.1:${inject('stubPort')}`

describe('stub vendor', () => {
  it('serves /ok.js with ETag, Cache-Control, and the synthetic body', async () => {
    const res = await fetch(`${origin()}/ok.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript')
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{16}"$/)
    expect(res.headers.get('cache-control')).toBe('max-age=1')
    expect(await res.text()).toContain("window.__sp")
  })

  it('answers 304 on a matching If-None-Match', async () => {
    const first = await fetch(`${origin()}/ok.js`)
    const etag = first.headers.get('etag')!
    const res = await fetch(`${origin()}/ok.js`, { headers: { 'if-none-match': etag } })
    expect(res.status).toBe(304)
  })

  it('logs requests and clears the log on DELETE /__log', async () => {
    await fetch(`${origin()}/__log`, { method: 'DELETE' })
    await fetch(`${origin()}/ok.css`)
    let log = (await (await fetch(`${origin()}/__log`)).json()) as Array<{ path: string }>
    expect(log).toHaveLength(1)
    expect(log[0].path).toBe('/ok.css')
    await fetch(`${origin()}/__log`, { method: 'DELETE' })
    log = (await (await fetch(`${origin()}/__log`)).json()) as Array<{ path: string }>
    expect(log).toHaveLength(0)
  })

  it('rotates /rotate.js on every request', async () => {
    const a = await (await fetch(`${origin()}/rotate.js`)).text()
    const b = await (await fetch(`${origin()}/rotate.js`)).text()
    expect(a).not.toBe(b)
  })

  it('switches /toggle.js between ok and 500 via /__mode', async () => {
    await fetch(`${origin()}/__mode?mode=500`, { method: 'POST' })
    expect((await fetch(`${origin()}/toggle.js`)).status).toBe(500)
    await fetch(`${origin()}/__mode?mode=ok`, { method: 'POST' })
    expect((await fetch(`${origin()}/toggle.js`)).status).toBe(200)
  })

  it('refuses connections on the dead port', async () => {
    await expect(fetch(`http://127.0.0.1:${inject('deadPort')}/ok.js`)).rejects.toThrow()
  })
})
