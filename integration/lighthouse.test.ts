import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launch, type LaunchedChrome } from 'chrome-launcher'
import lighthouse from 'lighthouse'
import { startRrNode, startStub, type App } from './driver.ts'
import type { StubVendor } from '../packages/secondparty/test/stub/vendor.ts'
import { evalInNewTab } from './cdp.ts'

let stub: StubVendor
let app: App
let chrome: LaunchedChrome

beforeAll(async () => {
  stub = await startStub()
  app = await startRrNode()
  chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox'] })
})
afterAll(async () => {
  chrome?.kill()
  await app?.kill()
  await stub?.close()
})

async function cacheInsightItems(url: string): Promise<Array<{ url?: string }>> {
  const result = await lighthouse(url, {
    port: chrome.port,
    output: 'json',
    onlyAudits: ['cache-insight'], // Lighthouse 13 audit id
    logLevel: 'error',
  })
  const audit = result!.lhr.audits['cache-insight']!
  const details = audit.details as { items?: Array<{ url?: string }> } | undefined
  return details?.items ?? []
}

describe('row 13 (stub half): Lighthouse cache-insight and execution', () => {
  it('/before flags the raw stub URL', async () => {
    const items = await cacheInsightItems(`${app.base}/before`)
    expect(items.some((i) => String(i.url).includes('127.0.0.1:4567'))).toBe(true)
  })

  it('/ has no /__sp/ item in cache-insight', async () => {
    const items = await cacheInsightItems(`${app.base}/`)
    expect(items.some((i) => String(i.url).includes('/__sp/'))).toBe(false)
  })

  it('the proxied scripts execute: window.__sp holds the stub keys', async () => {
    const value = (await evalInNewTab(
      chrome.port,
      `${app.base}/`,
      'window.__sp && window.__sp.length >= 3 ? window.__sp : null',
    )) as Array<{ key: string }> | undefined
    expect(value).toBeDefined()
    const keys = new Set(value!.map((v) => v.key))
    expect(keys.has('ok')).toBe(true)
    expect(keys.has('rotate')).toBe(true)
    expect(keys.has('toggle')).toBe(true)
  })
})
