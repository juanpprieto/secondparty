import net from 'node:net'
import type { AddressInfo } from 'node:net'
import type { TestProject } from 'vitest/node'
import { startStubVendor } from './stub/vendor.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    stubPort: number
    deadPort: number
  }
}

export default async function setup(project: TestProject) {
  const stub = await startStubVendor()
  // deadPort: opened then closed, so a fetch gets ECONNREFUSED (ticket 19 §1).
  const deadPort = await new Promise<number>((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port
      s.close(() => resolve(p))
    })
  })
  project.provide('stubPort', stub.port)
  project.provide('deadPort', deadPort)
  return () => stub.close()
}
