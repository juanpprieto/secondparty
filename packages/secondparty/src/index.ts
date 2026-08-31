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

const EXT: Record<string, string> = {
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/x-javascript': 'js',
  'text/css': 'css',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'application/json': 'json',
}
const NEGATIVE_TTL = 30

async function sha256hex16(bytes: Uint8Array): Promise<string> {
  // The cast avoids BufferSource, which needs the dom lib this tsconfig excludes.
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(buf)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

type Record_ = {
  bytes: Uint8Array
  contentType: string
  ext: string
  hash: string
  fetchedAt: string
  etag?: string
  vendorCacheControl?: string
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
  const cacheKey = (key: string) => `https://secondparty.invalid/${key}`
  const cfg = (key: string) => {
    const e = (options.entries as Record<string, Entry>)[key]!
    return { url: e.url, ttl: e.ttl ?? ttl, staleTtl: e.staleTtl ?? staleTtl, timeout: e.timeout ?? timeout }
  }
  const ageOf = (fetchedAt: string) => (Date.now() - Date.parse(fetchedAt)) / 1000

  async function readRecord(
    cache: CacheLike,
    key: string,
  ): Promise<{ negative: true; fetchedAt: string; code: SecondpartyError['code'] } | Record_ | undefined> {
    const res = await cache.match(cacheKey(key))
    if (!res) return undefined
    const h = res.headers
    if (h.get('x-sp-negative')) {
      return {
        negative: true,
        fetchedAt: h.get('x-sp-fetched-at')!,
        code: (h.get('x-sp-error-code') ?? 'network') as SecondpartyError['code'],
      }
    }
    const rec: Record_ = {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: h.get('content-type')!,
      ext: h.get('x-sp-ext')!,
      hash: h.get('x-sp-hash')!,
      fetchedAt: h.get('x-sp-fetched-at')!,
    }
    const etag = h.get('x-sp-etag')
    if (etag) rec.etag = etag
    const vcc = h.get('x-sp-vendor-cache-control')
    if (vcc) rec.vendorCacheControl = vcc
    return rec
  }

  async function writeRecord(cache: CacheLike, key: string, rec: Record_) {
    const headers: Record<string, string> = {
      'content-type': rec.contentType,
      'x-sp-ext': rec.ext,
      'x-sp-hash': rec.hash,
      'x-sp-fetched-at': rec.fetchedAt,
      // s-maxage keeps the record alive in a real Cache API for the whole retention window.
      'cache-control': `s-maxage=${cfg(key).staleTtl}`,
    }
    if (rec.etag) headers['x-sp-etag'] = rec.etag
    if (rec.vendorCacheControl) headers['x-sp-vendor-cache-control'] = rec.vendorCacheControl
    await cache.put(cacheKey(key), new Response(rec.bytes.slice(), { headers }))
  }

  async function fetchVendor(key: string): Promise<{ status: 200; rec: Record_; durationMs: number }> {
    const c = cfg(key)
    const headers: Record<string, string> = { 'user-agent': userAgent }
    const t0 = Date.now()
    const res = await fetch(c.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(c.timeout * 1000) })
    const durationMs = Date.now() - t0
    const contentType = res.headers.get('content-type') ?? ''
    const mime = contentType.split(';')[0]!.trim().toLowerCase()
    const ext = EXT[mime]!
    const bytes = new Uint8Array(await res.arrayBuffer())
    const rec: Record_ = { bytes, contentType, ext, hash: await sha256hex16(bytes), fetchedAt: new Date().toISOString() }
    const etag = res.headers.get('etag')
    if (etag) rec.etag = etag
    const vcc = res.headers.get('cache-control')
    if (vcc) rec.vendorCacheControl = vcc
    return { status: 200, rec, durationMs }
  }

  type Outcome = { rec?: Record_; stale: boolean; degraded: boolean; error?: SecondpartyError }

  async function resolve(cache: CacheLike, key: string, site: 'render' | 'handler'): Promise<Outcome> {
    const c = cfg(key)
    const existing = await readRecord(cache, key)
    const prev = existing && !('negative' in existing) ? existing : undefined
    if (prev && ageOf(prev.fetchedAt) < c.ttl) {
      emit({ type: 'hit', key, site, hash: prev.hash, fetchedAt: prev.fetchedAt })
      return { rec: prev, stale: false, degraded: false }
    }
    return fetchAndStore(cache, key, site)
  }

  async function fetchAndStore(cache: CacheLike, key: string, site: 'render' | 'handler'): Promise<Outcome> {
    const { status, rec, durationMs } = await fetchVendor(key)
    await writeRecord(cache, key, rec)
    emit({ type: 'fetch', key, site, hash: rec.hash, fetchedAt: rec.fetchedAt, status, durationMs })
    return { rec, stale: false, degraded: false }
  }

  const entries = Object.fromEntries(
    Object.keys(options.entries).map((key) => [
      key,
      async ({ cache }: EntryContext): Promise<EntryResult> => {
        const r = await resolve(cache, key, 'render')
        if (r.degraded || !r.rec) return { url: cfg(key).url, degraded: true }
        return { url: `${prefix}${key}.${r.rec.hash}.${r.rec.ext}`, degraded: false }
      },
    ]),
  ) as unknown as Entries<T>

  async function handle(_request: Request, _ctx: EntryContext): Promise<Response> {
    throw new Error('secondparty: handle not implemented yet')
  }

  return { entries, handle }
}
