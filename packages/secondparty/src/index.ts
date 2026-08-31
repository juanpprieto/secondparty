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
const SEGMENT = /^(?<key>[A-Za-z0-9_-]+)\.(?<hash>[0-9a-f]{16})\.(?<ext>[a-z0-9]+)$/

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

  // The hook wrapper: a set hook replaces the default warn; hook faults are swallowed.
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

  async function writeNegative(cache: CacheLike, key: string, code: SecondpartyError['code']) {
    await cache.put(
      cacheKey(key),
      new Response('x', {
        headers: {
          'x-sp-negative': '1',
          'x-sp-error-code': code,
          'x-sp-fetched-at': new Date().toISOString(),
          'cache-control': `s-maxage=${NEGATIVE_TTL}`,
        },
      }),
    )
  }

  async function fetchVendor(key: string, prev?: Record_): Promise<{ status: 200 | 304; rec: Record_; durationMs: number }> {
    const c = cfg(key)
    const headers: Record<string, string> = { 'user-agent': userAgent }
    if (prev?.etag) headers['if-none-match'] = prev.etag
    const t0 = Date.now()
    let res: Response
    try {
      res = await fetch(c.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(c.timeout * 1000) })
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError'
      throw new SecondpartyError(
        timedOut ? 'timeout' : 'network',
        key,
        timedOut ? `vendor timeout after ${c.timeout}s` : `vendor fetch failed: ${(cause as Error)?.message}`,
        { cause },
      )
    }
    const durationMs = Date.now() - t0
    if (res.status === 304 && prev) {
      await res.arrayBuffer().catch(() => {})
      return { status: 304, rec: { ...prev, fetchedAt: new Date().toISOString() }, durationMs }
    }
    if (res.status < 200 || res.status > 299) {
      await res.arrayBuffer().catch(() => {})
      throw new SecondpartyError('status', key, `vendor answered ${res.status}`, { status: res.status })
    }
    const contentType = res.headers.get('content-type') ?? ''
    const mime = contentType.split(';')[0]!.trim().toLowerCase()
    const ext = EXT[mime]
    if (!ext) {
      await res.arrayBuffer().catch(() => {})
      throw new SecondpartyError('content_type', key, `content-type outside the map: ${contentType}`)
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    const rec: Record_ = { bytes, contentType, ext, hash: await sha256hex16(bytes), fetchedAt: new Date().toISOString() }
    const etag = res.headers.get('etag')
    if (etag) rec.etag = etag
    const vcc = res.headers.get('cache-control')
    if (vcc) rec.vendorCacheControl = vcc
    return { status: 200, rec, durationMs }
  }

  type Outcome = { rec?: Record_; stale: boolean; degraded: boolean; error?: SecondpartyError }

  // One in-flight vendor fetch per key per config, in memory. Keyed per config,
  // never per cache object: workerd caches.open() returns a new object per call.
  const inflight = new Map<string, Promise<Outcome>>()

  async function resolve(cache: CacheLike, key: string, site: 'render' | 'handler'): Promise<Outcome> {
    const c = cfg(key)
    const existing = await readRecord(cache, key)
    if (existing && 'negative' in existing) {
      if (ageOf(existing.fetchedAt) < NEGATIVE_TTL) {
        const error = new SecondpartyError(existing.code, key, `inside negative window (${existing.code})`)
        emit({ type: 'degraded', key, site, error })
        return { stale: false, degraded: true, error }
      }
    }
    const prev = existing && !('negative' in existing) ? existing : undefined
    if (prev && ageOf(prev.fetchedAt) < c.ttl) {
      emit({ type: 'hit', key, site, hash: prev.hash, fetchedAt: prev.fetchedAt })
      return { rec: prev, stale: false, degraded: false }
    }
    const leader = inflight.get(key)
    if (leader) {
      const r = await leader
      // Waiters emit only their own outcome event, with the leader's error.
      if (r.degraded || !r.rec) emit({ type: 'degraded', key, site, error: r.error! })
      else if (r.stale) emit({ type: 'stale', key, site, hash: r.rec.hash, fetchedAt: r.rec.fetchedAt })
      else emit({ type: 'hit', key, site, hash: r.rec.hash, fetchedAt: r.rec.fetchedAt })
      return r
    }
    const flight = fetchAndStore(cache, key, site, prev).finally(() => inflight.delete(key))
    inflight.set(key, flight)
    return flight
  }

  async function fetchAndStore(cache: CacheLike, key: string, site: 'render' | 'handler', prev?: Record_): Promise<Outcome> {
    const c = cfg(key)
    try {
      const { status, rec, durationMs } = await fetchVendor(key, prev)
      await writeRecord(cache, key, rec)
      emit({ type: 'fetch', key, site, hash: rec.hash, fetchedAt: rec.fetchedAt, status, durationMs })
      return { rec, stale: false, degraded: false }
    } catch (e) {
      const error = e instanceof SecondpartyError ? e : new SecondpartyError('network', key, String(e), { cause: e })
      emit({ type: 'error', key, site, error })
      if (prev && ageOf(prev.fetchedAt) < c.staleTtl) {
        emit({ type: 'stale', key, site, hash: prev.hash, fetchedAt: prev.fetchedAt })
        return { rec: prev, stale: true, degraded: false, error }
      }
      await writeNegative(cache, key, error.code)
      emit({ type: 'degraded', key, site, error })
      return { stale: false, degraded: true, error }
    }
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

  async function handle(request: Request, { cache }: EntryContext): Promise<Response> {
    const noStore = (status: number, headers: Record<string, string> = {}) =>
      new Response(null, { status, headers: { 'cache-control': 'no-store', ...headers } })
    const segment = new URL(request.url).pathname.split('/').pop() ?? ''
    const m = SEGMENT.exec(segment)
    if (!m?.groups) return noStore(404)
    const { key, hash } = m.groups as { key: string; hash: string }
    if (!(key in (options.entries as object))) return noStore(404)
    if (request.method !== 'GET' && request.method !== 'HEAD') return noStore(405, { allow: 'GET, HEAD' })
    const r = await resolve(cache, key, 'handler')
    if (!r.rec) return noStore(502, { 'x-secondparty-error': r.error?.code ?? 'network' })
    const rec = r.rec
    const c = cfg(key)
    const headers = new Headers({
      'content-type': rec.contentType,
      'content-length': String(rec.bytes.byteLength),
      etag: `"${rec.hash}"`,
      vary: 'Accept-Encoding',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      'x-secondparty-key': key,
      'x-secondparty-fetched-at': rec.fetchedAt,
      'x-secondparty-source': c.url,
      'cache-control':
        hash === rec.hash && !r.stale
          ? 'public, max-age=31536000, s-maxage=31536000, immutable'
          : `public, max-age=${c.ttl}, s-maxage=${c.ttl}`,
    })
    if (rec.vendorCacheControl) headers.set('x-secondparty-vendor-cache-control', rec.vendorCacheControl)
    if (r.stale) headers.set('x-secondparty-stale', '1')
    const inm = request.headers.get('if-none-match')
    if (inm && inm.replace(/^W\//, '') === `"${rec.hash}"`) return new Response(null, { status: 304, headers })
    return new Response(request.method === 'HEAD' ? null : rec.bytes.slice(), { status: 200, headers })
  }

  return { entries, handle }
}
