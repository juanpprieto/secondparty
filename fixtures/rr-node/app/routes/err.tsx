import type { Route } from './+types/err'
import { entries } from '~/secondparty.config.server'
import { getCache } from '~/context'

export async function loader() {
  const r = await entries.badct({ cache: await getCache() })
  return { url: r.url, degraded: r.degraded }
}

export default function Err({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <p data-degraded={String(loaderData.degraded)}>{loaderData.url}</p>
      <script src={loaderData.url} />
    </main>
  )
}
