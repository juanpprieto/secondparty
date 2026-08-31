import { VERSION } from './version.js'

// Public types (docs/spec/v1-api.md "Public API"; eight types).
export type Entry = { url: string; ttl?: number; staleTtl?: number; timeout?: number }
type Exact<T, Shape> = T & { [K in Exclude<keyof T, keyof Shape>]: never }
export type CacheLike = {
  match(request: Request | string): Promise<Response | undefined>
  put(request: Request | string, response: Response): Promise<void>
}
export type EntryContext = { cache: CacheLike }
export type EntryResult = { url: string; degraded: boolean }
export type EntryFunction = (ctx: EntryContext) => Promise<EntryResult>
export type Entries<T> = { readonly [K in keyof T]: EntryFunction }
export type SecondpartyEvent = { key: string; site: 'render' | 'handler' } & (
  | { type: 'hit'; hash: string; fetchedAt: string }
  | { type: 'fetch'; hash: string; fetchedAt: string; status: 200 | 304; durationMs: number }
  | { type: 'stale'; hash: string; fetchedAt: string }
  | { type: 'degraded'; error: SecondpartyError }
  | { type: 'error'; error: SecondpartyError }
)
export type SecondpartyOptions<T extends Record<string, Entry>> = {
  entries: T & { [K in keyof T]: Exact<T[K], Entry> }
  ttl?: number
  staleTtl?: number
  timeout?: number
  prefix?: string
  userAgent?: string
  onEvent?: (event: SecondpartyEvent) => void
}

export class SecondpartyError extends Error {
  code: 'timeout' | 'status' | 'content_type' | 'network'
  key: string
  status?: number
  cause?: unknown
  constructor(
    code: SecondpartyError['code'],
    key: string,
    message: string,
    extra: { status?: number; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'SecondpartyError'
    this.code = code
    this.key = key
    if (extra.status !== undefined) this.status = extra.status
    if (extra.cause !== undefined) this.cause = extra.cause
  }
}

export function createMemoryCache(): CacheLike {
  const store = new Map<string, { body: Uint8Array; headers: [string, string][]; status: number }>()
  const keyOf = (r: Request | string) => (typeof r === 'string' ? r : r.url)
  return {
    async match(r) {
      const rec = store.get(keyOf(r))
      if (!rec) return undefined
      return new Response(rec.body.slice(), { status: rec.status, headers: rec.headers })
    },
    async put(r, res) {
      const body = new Uint8Array(await res.arrayBuffer())
      store.set(keyOf(r), { body, headers: [...res.headers], status: res.status })
    },
  }
}

export function defineSecondparty<const T extends Record<string, Entry>>(options: SecondpartyOptions<T>) {
  // globalThis read, not a bare identifier: tsconfig has no dom lib (CacheLike must compile without it).
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') {
    throw new Error('secondparty: config imported in a client module')
  }

  const ttl = options.ttl ?? 3600
  const staleTtl = options.staleTtl ?? 604800
  const timeout = options.timeout ?? 5
  const prefix = options.prefix ?? '/__sp/'
  const userAgent = options.userAgent ?? `secondparty/${VERSION}`

  const failures: string[] = []
  if (!prefix.startsWith('/')) failures.push(`prefix must start with "/": ${prefix}`)
  if (!(ttl > 0)) failures.push('ttl must be > 0')
  if (!(timeout > 0)) failures.push('timeout must be > 0')
  for (const [key, e] of Object.entries(options.entries as Record<string, Entry>)) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) failures.push(`key "${key}": charset [A-Za-z0-9_-]+`)
    let ok = false
    try {
      const u = new URL(e.url)
      ok = u.protocol === 'http:' || u.protocol === 'https:'
    } catch {}
    if (!ok) failures.push(`entry "${key}": url must be http: or https: (${e.url})`)
    const t = e.ttl ?? ttl
    const s = e.staleTtl ?? staleTtl
    const to = e.timeout ?? timeout
    if (!(t > 0)) failures.push(`entry "${key}": ttl must be > 0`)
    if (!(s >= t)) failures.push(`entry "${key}": staleTtl must be >= ttl`)
    if (!(to > 0)) failures.push(`entry "${key}": timeout must be > 0`)
  }
  if (failures.length) throw new Error(`secondparty: invalid config\n- ${failures.join('\n- ')}`)

  // The hook wrapper: a set hook replaces the default warn; hook faults are swallowed (ticket 10).
  const emit = (event: SecondpartyEvent) => {
    if (options.onEvent) {
      try {
        options.onEvent(event)
      } catch {}
      return
    }
    if (event.type === 'error' || event.type === 'degraded') {
      console.warn('[secondparty]', event.key, event.type, event.error.code, event.error.message)
    }
  }
  void emit
  void userAgent

  const entries = Object.fromEntries(
    Object.keys(options.entries).map((key) => [
      key,
      async (_ctx: EntryContext): Promise<EntryResult> => {
        throw new Error(`secondparty: entry "${key}" not implemented yet`)
      },
    ]),
  ) as unknown as Entries<T>

  async function handle(_request: Request, _ctx: EntryContext): Promise<Response> {
    throw new Error('secondparty: handle not implemented yet')
  }

  return { entries, handle }
}
