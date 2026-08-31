# Releasing

One-time setup: on npmjs.com, open the `secondparty` package settings and add a
trusted publisher: GitHub Actions, repository `juanpprieto/secondparty`, workflow
`release.yml`. No npm token is stored anywhere; the workflow authenticates with OIDC.

Per change, on the branch that makes it:

1. Run `pnpm changeset` and describe the change.

At release time, on `main`:

1. Run `pnpm changeset version`.
2. Sync `packages/secondparty/src/version.ts` `VERSION` to the new `package.json` version.
3. Commit the version bump and changelog.
4. Tag: `git tag vX.Y.Z` (match the package version).
5. Push: `git push && git push --tags`.

The tag push starts `.github/workflows/release.yml`: install, build, unit tests, a
check that `src/version.ts` equals `package.json`, then `npm publish` with provenance
from trusted publishing.
