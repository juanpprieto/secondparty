import type { Route } from './+types/slow'
import { entries } from '~/secondparty.config.server'
import { getCache } from '~/context'

export async function loader() {
  const r = await entries.slow({ cache: await getCache() })
  return { url: r.url, degraded: r.degraded }
}

export default function Slow({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <p data-degraded={String(loaderData.degraded)}>{loaderData.url}</p>
      <script src={loaderData.url} />
    </main>
  )
}
