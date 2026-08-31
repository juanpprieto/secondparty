import type {LoaderFunctionArgs} from 'react-router';

export async function loader({request, context}: LoaderFunctionArgs) {
  const res = await context.secondparty.handle(request, {cache: context.spCache});
  // Oxygen splits caching: Cache-Control reaches the browser; the CDN needs
  // Oxygen-Cache-Control on the route.
  const cc = res.headers.get('cache-control');
  if (cc && cc !== 'no-store') res.headers.set('Oxygen-Cache-Control', cc);
  return res;
}
