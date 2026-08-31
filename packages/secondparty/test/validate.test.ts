import { describe, expect, it } from 'vitest'
import { defineSecondparty } from '../src/index.ts'

const URL_OK = 'https://vendor.example/ok.js'

describe('defineSecondparty validation (spec: six load-time checks)', () => {
  it('accepts a minimal valid config', () => {
    expect(() => defineSecondparty({ entries: { ok: { url: URL_OK } } })).not.toThrow()
  })

  it('throws one Error that lists every failed check', () => {
    let message = ''
    try {
      defineSecondparty({
        prefix: 'sp/',
        entries: {
          'bad key!': { url: URL_OK },
          badurl: { url: 'ftp://x' },
          badttl: { url: URL_OK, ttl: 0 },
          badstale: { url: URL_OK, ttl: 100, staleTtl: 50 },
          badtimeout: { url: URL_OK, timeout: 0 },
        },
      })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('bad key!') // key charset [A-Za-z0-9_-]+
    expect(message).toContain('url') // spec row 11: the throw names `url`
    expect(message).toContain('ttl')
    expect(message).toContain('staleTtl')
    expect(message).toContain('timeout')
    expect(message).toContain('prefix')
  })

  it('checks staleTtl >= ttl after the per-entry merge', () => {
    // default staleTtl 604800; entry ttl above it must fail
    expect(() => defineSecondparty({ entries: { e: { url: URL_OK, ttl: 700000 } } })).toThrow(/staleTtl/)
  })

  it('allows a fractional timeout (spec: seconds, fractions allowed)', () => {
    expect(() => defineSecondparty({ entries: { e: { url: URL_OK, timeout: 0.1 } } })).not.toThrow()
  })

  it('throws when a document global exists (client-import guard, row 12)', () => {
    ;(globalThis as { document?: unknown }).document = {}
    try {
      expect(() => defineSecondparty({ entries: {} })).toThrow(/client/)
    } finally {
      delete (globalThis as { document?: unknown }).document
    }
  })
})
