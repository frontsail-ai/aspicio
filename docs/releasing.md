# Releasing

Publishing is one command: push a version tag and CI does the rest.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The [publish workflow](../.github/workflows/publish.yml) then re-runs the
lint/test gate, stamps `0.1.0` into the package manifests, builds, and
publishes `@aspicio/core`, `@aspicio/elements`, `@aspicio/react`,
`@aspicio/vue`, and `@aspicio/mcp`.

## Always release the tip of master

Tags are cut from the current tip of `master` — never from a branch or an
older commit. Before tagging:

1. **Bump `server.json`.** Its top-level and package `version` fields are
   pinned (the registry has no workspace stamping); set them to the new
   version in the release PR or a pre-tag commit (INV-9), then re-run
   `mcp-publisher publish` after the release so the listing follows.
2. **Wait for pending PRs.** If any open PR belongs in the release —
   features, fixes, or (easy to miss) changes to the publish workflow
   itself — it merges first. A release cut around an unmerged PR silently
   ships without it: v0.4.0 nearly shipped without `@aspicio/mcp` because
   the PR wiring it into publishing was still open.
3. **Sync and verify.** `git fetch && git checkout master && git pull`;
   confirm the working tree is clean and local `master` matches
   `origin/master`.
4. **Tag that commit** and push the tag.

## One-time setup (repo owner)

1. **Claim the npm scope.** Create the `aspicio` organization on
   [npmjs.com](https://www.npmjs.com) — scoped packages publish under it.
2. **Create an automation token.** npmjs.com → Access Tokens → Generate →
   Granular access token, with read/write on packages in the `@aspicio`
   scope. Automation tokens bypass 2FA prompts, which CI needs.
3. **Add the secret.** `gh secret set NPM_TOKEN` (or repo Settings →
   Secrets and variables → Actions → `NPM_TOKEN`).

## Versioning policy

- **One version for all public packages.** `@aspicio/core`,
  `@aspicio/elements`, `@aspicio/react`, `@aspicio/vue`, and
  `@aspicio/mcp` always release together with the same number (INV-9).
  Revisit (e.g. with changesets) only if their release cadences genuinely
  diverge.
- **The tag is the source of truth.** Manifests in the repo stay at
  `0.0.0`; the workflow stamps the tag's version at publish time. There
  are no release commits to merge or rebase around.
- **Pre-1.0 semver:** feature batches bump the minor (`0.1.0` → `0.2.0`) —
  the practice every release so far has followed — and fix-only releases
  bump the patch. Breaking changes also bump the minor, called out in the
  release notes.
- `@aspicio/elements` depends on core — and `@aspicio/react` and
  `@aspicio/vue` on both — as `workspace:^`, which the publish workflow
  rewrites to `^<version>`; consumers can patch-update the lower layers
  independently.

## Dry runs

Before the first real release (or any risky one), run the workflow
manually: GitHub → Actions → "Publish to npm" → Run workflow → enter a
version and check **dry run**. It executes the entire pipeline — gate,
version stamping, builds, tarball packing — and uploads nothing. Works
even before `NPM_TOKEN` exists.

The same dry run works locally:

```bash
vp run -r build
cd packages/core && bun publish --access public --dry-run
cd ../elements && bun publish --access public --dry-run
cd ../react && bun publish --access public --dry-run
cd ../vue && bun publish --access public --dry-run
cd ../mcp && bun publish --access public --dry-run
```

## Verifying a release

```bash
npm view @aspicio/core version           # the new version is live
npm view @aspicio/elements dependencies  # core range is ^<version>
npm view @aspicio/react dependencies     # elements + core ranges are ^<version>
npm view @aspicio/vue dependencies       # same for the Vue bindings
npm view @aspicio/mcp dependencies       # same for the MCP server
npx -y @aspicio/mcp </dev/null           # the agent entry point resolves
```

Then the real proof: `npm install @aspicio/react` in a scratch app and
render a drawing.

## When things go wrong

- **The gate fails** — nothing was published; fix the failure on `master`,
  delete and re-push the tag (`git tag -d v0.1.0 && git push --delete
origin v0.1.0`, then re-tag). Deleting tags is safe _only_ while the
  publish failed — never move a tag whose version reached npm.
- **Core published, react failed** (network, registry hiccup) — do **not**
  re-push the same tag: npm refuses to republish an existing version, so
  core would fail the whole run. Instead fix the cause and release the
  next patch version. A version gap is cheaper than a broken registry
  state.
- **A bad version shipped** — npm forbids unpublishing after 72 hours (and
  it breaks downstream lockfiles anyway). Deprecate instead:
  `npm deprecate @aspicio/core@0.1.0 "broken, use 0.1.1"`, then release
  the fix.
- **`403` on publish** — the token expired, lacks the `@aspicio` scope, or
  the org name isn't claimed. Re-check the one-time setup.

## What exactly ships

Each package publishes only `dist/` (built by `vp pack`: `index.mjs` +
`index.d.mts`), `README.md`, and `package.json` — enforced by the `files`
field. `three` and `dxf-parser` are regular dependencies, as is `lit` in
`@aspicio/elements`; `react` and `vue` are peers of their bindings.
Check the exact contents any time with `bun pm pack` in the package
directory.
