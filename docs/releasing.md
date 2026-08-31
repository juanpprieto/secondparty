# Releasing

One-time setup: on npmjs.com, open the `secondparty` package settings and add a
trusted publisher: GitHub Actions, repository `juanpprieto/secondparty`, workflow
`release.yml`. No npm token is stored anywhere; the workflow authenticates with OIDC.

Caveat: npmjs.com shows package settings only after the package exists. If the
registry rejects a trusted publisher for a new name, run the first `npm publish`
from your machine, then register the trusted publisher for every later release.

Gate before the first publish: test the built package in a local app outside this
repository. Use `npm link`, or install the tarball from `npm pack`. Check the quick
start against that install.

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
