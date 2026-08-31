import { afterAll, beforeAll, describe } from 'vitest'
import { startRrWorkers, startStub, type App } from './driver.ts'
import type { StubVendor } from '../packages/secondparty/test/stub/vendor.ts'
import { defineRowTests } from './rows.ts'

let stub: StubVendor
let app: App

beforeAll(async () => {
  stub = await startStub()
  app = await startRrWorkers()
})
afterAll(async () => {
  await app?.kill()
  await stub?.close()
})

describe('rr-workers (wrangler dev, port 8790) — row 14 parity', () => {
  defineRowTests(() => app)
})
