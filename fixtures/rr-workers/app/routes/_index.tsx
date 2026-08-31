import type { Route } from './+types/_index'
import { entries } from '~/secondparty.config.server'
import { getCache } from '~/context'

export async function loader() {
  const cache = await getCache()
  const [ok, css, rotate, toggle] = await Promise.all([
    entries.ok({ cache }),
    entries.css({ cache }),
    entries.rotate({ cache }),
    entries.toggle({ cache }),
  ])
  return { ok: ok.url, css: css.url, rotate: rotate.url, toggle: toggle.url }
}

export default function Index({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>after (proxied)</h1>
      <link rel="stylesheet" href={loaderData.css} />
      <script src={loaderData.ok} />
      <script src={loaderData.rotate} />
      <script src={loaderData.toggle} />
    </main>
  )
}
