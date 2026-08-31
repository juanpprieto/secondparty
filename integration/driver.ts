import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startStubVendor, type StubVendor } from '../packages/secondparty/test/stub/vendor.ts'

export const STUB_PORT = 4567
export const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`

export const startStub = (): Promise<StubVendor> => startStubVendor(STUB_PORT)

export type App = { base: string; kill(): Promise<void> }

const fixtureDir = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

async function waitFor(url: string, timeoutMs = 120_000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${url}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve()
    const hard = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => {
      clearTimeout(hard)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

export async function startRrNode(): Promise<App> {
  const child = spawn('node_modules/.bin/react-router-serve', ['./build/server/index.js'], {
    cwd: fixtureDir('rr-node'),
    env: {
      ...process.env,
      PORT: '3100',
      SP_STUB_ORIGIN: STUB_ORIGIN,
      SP_FIXTURE_DEBUG: '1',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  await waitFor('http://localhost:3100/__debug')
  return { base: 'http://localhost:3100', kill: () => killChild(child) }
}

export async function startRrWorkers(): Promise<App> {
  const child = spawn(
    'node_modules/.bin/wrangler',
    ['dev', '--config', 'build/server/wrangler.json', '--port', '8790'],
    { cwd: fixtureDir('rr-workers'), env: { ...process.env }, stdio: ['ignore', 'inherit', 'inherit'] },
  )
  await waitFor('http://localhost:8790/__debug')
  return { base: 'http://localhost:8790', kill: () => killChild(child) }
}

// Fixture debug endpoint (SP_FIXTURE_DEBUG=1).
export type FlatEvent = { type: string; key: string; site: string; hash?: string; status?: number; code?: string }
export async function dbg(base: string, query = ''): Promise<{ runtime: string; events: FlatEvent[] }> {
  const res = await fetch(`${base}/__debug${query}`)
  if (res.status !== 200) throw new Error(`__debug answered ${res.status}`)
  return res.json()
}

// Stub witnesses.
export const stubLog = async (): Promise<Array<{ path: string; ifNoneMatch?: string; cookie?: string }>> =>
  (await fetch(`${STUB_ORIGIN}/__log`)).json()
export const clearStubLog = async () => {
  await fetch(`${STUB_ORIGIN}/__log`, { method: 'DELETE' })
}
export const setToggleMode = async (mode: 'ok' | '500') => {
  await fetch(`${STUB_ORIGIN}/__mode?mode=${mode}`, { method: 'POST' })
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
