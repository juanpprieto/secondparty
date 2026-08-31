import { createCookieSessionStorage } from 'react-router'

export const { getSession, commitSession } = createCookieSessionStorage({
  cookie: { name: '__session', secrets: ['fixture'], sameSite: 'lax', path: '/', httpOnly: true },
})
