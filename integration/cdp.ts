// Minimal CDP client: open a tab, evaluate an expression, close the tab.
// Exists so the execution check needs no puppeteer dependency (overview deviation note).

type Tab = { id: string; webSocketDebuggerUrl: string }

export async function evalInNewTab(chromePort: number, url: string, expression: string, tries = 40): Promise<unknown> {
  const tab = (await (
    await fetch(`http://127.0.0.1:${chromePort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  ).json()) as Tab
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const call = (method: string, params?: object) =>
    new Promise<{ result?: { value?: unknown } }>((resolve, reject) => {
      const msgId = ++id
      const onMessage = (ev: MessageEvent) => {
        const data = JSON.parse(String(ev.data))
        if (data.id === msgId) {
          ws.removeEventListener('message', onMessage)
          data.error ? reject(new Error(data.error.message)) : resolve(data.result)
        }
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  try {
    for (let i = 0; i < tries; i++) {
      const r = await call('Runtime.evaluate', { expression, returnByValue: true })
      const v = r?.result?.value
      if (v !== undefined && v !== null) return v
      await new Promise((r2) => setTimeout(r2, 250))
    }
    return undefined
  } finally {
    ws.close()
    await fetch(`http://127.0.0.1:${chromePort}/json/close/${tab.id}`).catch(() => {})
  }
}
