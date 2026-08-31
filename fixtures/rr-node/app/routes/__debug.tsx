// Fixture-only, behind SP_FIXTURE_DEBUG=1 (ticket 19 §4). Never a core feature.
import type { Route } from './+types/__debug'
import { state } from '~/debug.server'
import { entries } from '~/secondparty.config.server'
import { resetCache, runtime } from '~/context'

export async function loader({ request }: Route.LoaderArgs) {
  if (process.env.SP_FIXTURE_DEBUG !== '1') throw new Response('Not Found', { status: 404 })
  const q = new URL(request.url).searchParams
  const out: Record<string, unknown> = { runtime: runtime(), events: state.events }
  if (q.has('reset')) out.reset = await resetCache(Object.keys(entries))
  if (q.has('throwhook')) state.throwHook = q.get('throwhook') === '1'
  if (q.has('clear')) state.events = []
  return Response.json(out, { headers: { 'cache-control': 'no-store' } })
}
