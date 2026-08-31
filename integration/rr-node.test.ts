import { afterAll, beforeAll, describe } from 'vitest'
import { startRrNode, startStub, type App } from './driver.ts'
import type { StubVendor } from '../packages/secondparty/test/stub/vendor.ts'
import { defineRowTests } from './rows.ts'

let stub: StubVendor
let app: App

beforeAll(async () => {
  stub = await startStub()
  app = await startRrNode()
})
afterAll(async () => {
  await app?.kill()
  await stub?.close()
})

describe('rr-node (react-router-serve, port 3100)', () => {
  defineRowTests(() => app)
})
