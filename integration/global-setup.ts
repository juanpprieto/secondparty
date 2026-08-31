import { execSync } from 'node:child_process'

export default function setup() {
  if (process.env.SP_SKIP_FIXTURE_BUILD === '1') return // CI builds beforehand
  execSync('pnpm --filter secondparty build', { stdio: 'inherit' })
  execSync('pnpm --filter rr-node build', { stdio: 'inherit' })
  execSync('pnpm --filter rr-workers build', { stdio: 'inherit' })
}
