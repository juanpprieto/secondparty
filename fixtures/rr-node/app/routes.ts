import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

export default [
  // Session middleware lives on this layout only. /__sp/* stays outside it.
  layout('routes/_layout.tsx', [
    index('routes/_index.tsx'),
    route('before', 'routes/before.tsx'),
    route('slow', 'routes/slow.tsx'),
    route('err', 'routes/err.tsx'),
  ]),
  route('__sp/*', 'routes/__sp.$.tsx'),
  route('__debug', 'routes/__debug.tsx'),
] satisfies RouteConfig
