import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineSecondparty } from '../src/index.ts'
import type { SecondpartyEvent } from '../src/index.ts'
import { clearStubLog, deadOrigin, freshCache, stubOrigin } from './helpers.ts'

beforeEach(async () => {
  vi.useRealTimers()
  await clearStubLog()
})

describe('onEvent defaults and faults', () => {
  it('console.warns once per error and once per degraded when no hook is set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { entries } = defineSecondparty({ entries: { e: { url: `${deadOrigin()}/x.js` } } })
      const r = await entries.e({ cache: await freshCache() })
      expect(r.degraded).toBe(true)
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('a set hook replaces the default warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const seen: SecondpartyEvent[] = []
      const { entries } = defineSecondparty({
        entries: { e: { url: `${deadOrigin()}/x.js` } },
        onEvent: (e) => seen.push(e),
      })
      await entries.e({ cache: await freshCache() })
      expect(seen.map((e) => e.type)).toEqual(['error', 'degraded'])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('a throwing hook is swallowed; the call still succeeds (row 10)', async () => {
    const { entries } = defineSecondparty({
      entries: { ok: { url: `${stubOrigin()}/ok.js` } },
      onEvent: () => {
        throw new Error('hook fault')
      },
    })
    const r = await entries.ok({ cache: await freshCache() })
    expect(r.degraded).toBe(false)
    expect(r.url).toMatch(/^\/__sp\/ok\./)
  })
})
