import type { Route } from './+types/before'

export async function loader() {
  return { url: `${process.env.SP_STUB_ORIGIN ?? 'http://127.0.0.1:4567'}/ok.js` }
}

export default function Before({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>before (vendor URL)</h1>
      <script src={loaderData.url} />
    </main>
  )
}
