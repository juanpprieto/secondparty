// Stub vendor: synthetic bodies, one route per fault mode, request log as witness.
// /toggle.js + POST /__mode exist because workerd unit tests cannot stop this
// Node process to simulate vendor-down.
import http from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo, Socket } from 'node:net'

export type StubRequest = {
  method: string
  path: string
  ifNoneMatch?: string
  userAgent?: string
  cookie?: string
}
export type StubVendor = { origin: string; port: number; close(): Promise<void> }

const jsBody = (route: string, v: string) =>
  `window.__sp = (window.__sp || []).concat([{ key: '${route}', v: '${v}' }])`
const CSS_BODY = '.sp{color:red}'
const etagOf = (body: string | Buffer) =>
  `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`
// Minimal WOFF2 header: 'wOF2' signature plus padding. The core never parses font bytes.
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(44)])

export function startStubVendor(port = 0): Promise<StubVendor> {
  const log: StubRequest[] = []
  let rotateN = 0
  let toggleMode: 'ok' | '500' = 'ok'
  const sockets = new Set<Socket>()

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const path = url.pathname

    // Control endpoints. Never logged: the log is the vendor-request witness.
    if (path === '/__log') {
      if (req.method === 'DELETE') {
        log.length = 0
        res.writeHead(204)
        return res.end()
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(log))
    }
    if (path === '/__mode') {
      toggleMode = url.searchParams.get('mode') === '500' ? '500' : 'ok'
      res.writeHead(204)
      return res.end()
    }

    const entry: StubRequest = { method: req.method ?? '', path: path + url.search }
    if (req.headers['if-none-match']) entry.ifNoneMatch = String(req.headers['if-none-match'])
    if (req.headers['user-agent']) entry.userAgent = String(req.headers['user-agent'])
    if (req.headers.cookie) entry.cookie = String(req.headers.cookie)
    log.push(entry)

    const okWithEtag = (body: string, contentType: string, extra: Record<string, string> = {}) => {
      const etag = etagOf(body)
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag })
        return res.end()
      }
      res.writeHead(200, { 'content-type': contentType, etag, ...extra })
      res.end(body)
    }

    switch (path) {
      case '/ok.js':
        return okWithEtag(jsBody('ok', '1'), 'text/javascript', { 'cache-control': 'max-age=1' })
      case '/toggle.js':
        if (toggleMode === '500') {
          res.writeHead(500, { 'content-type': 'text/javascript' })
          return res.end('/*500*/')
        }
        return okWithEtag(jsBody('toggle', '1'), 'text/javascript')
      case '/rotate.js': {
        rotateN++
        const body = jsBody('rotate', String(rotateN))
        res.writeHead(200, { 'content-type': 'text/javascript', etag: etagOf(body) })
        return res.end(body)
      }
      case '/ok.css':
        return okWithEtag(CSS_BODY, 'text/css')
      case '/ok.woff2':
        res.writeHead(200, { 'content-type': 'font/woff2' })
        return res.end(WOFF2)
      case '/ok.json':
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end('{}')
      case '/xjs.js':
        res.writeHead(200, { 'content-type': 'application/x-javascript' })
        return res.end(jsBody('xjs', '1'))
      case '/noext':
        res.writeHead(200, { 'content-type': 'text/javascript' })
        return res.end(jsBody('noext', '1'))
      case '/500.js':
        res.writeHead(500, { 'content-type': 'text/javascript' })
        return res.end('/*500*/')
      case '/html.js':
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end('<html>')
      case '/slow.js': {
        const ms = Number(url.searchParams.get('ms') ?? 3000)
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'text/javascript' })
          res.end(jsBody('slow', '1'))
        }, ms)
        return
      }
      case '/hang.js':
        return // never answers; close() destroys the socket
      case '/redirect.js':
        res.writeHead(302, { location: '/ok.js' })
        return res.end()
      case '/octet.woff2':
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        return res.end(WOFF2)
      default:
        res.writeHead(404)
        return res.end()
    }
  })

  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const p = (server.address() as AddressInfo).port
      resolve({
        origin: `http://127.0.0.1:${p}`,
        port: p,
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.destroy()
            server.close(() => r())
          }),
      })
    })
  })
}
