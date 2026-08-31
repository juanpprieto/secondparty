import type { Route } from './+types/__sp.$'
import { handle } from '~/secondparty.config.server'
import { getCache } from '~/context'

export const loader = async ({ request }: Route.LoaderArgs) => handle(request, { cache: await getCache() })
export const action = async ({ request }: Route.ActionArgs) => handle(request, { cache: await getCache() })
