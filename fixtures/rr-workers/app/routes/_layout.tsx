import { Outlet } from 'react-router'
import type { Route } from './+types/_layout'
import { commitSession, getSession } from '~/session.server'

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }, next) => {
    const session = await getSession(request.headers.get('Cookie'))
    session.set('seen', Date.now())
    const res = await next()
    res.headers.append('Set-Cookie', await commitSession(session))
    return res
  },
]
export default function LayoutRoute() {
  return <Outlet />
}
