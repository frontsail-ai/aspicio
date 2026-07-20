# Releasing

Publishing is one command: push a version tag and CI does the rest.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The [publish workflow](../.github/workflows/publish.yml) then re-runs the
lint/test gate, stamps `0.1.0` into the package manifests, builds, and
publishes `@aspicio/core`, `@aspicio/react`, and `@aspicio/mcp`.

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
  `@aspicio/react`, and `@aspicio/mcp` always release together with the
  same number (INV-9). Revisit (e.g. with
  changesets) only if their release cadences genuinely diverge.
- **The tag is the source of truth.** Manifests in the repo stay at
  `0.0.0`; the workflow stamps the tag's version at publish time. There
  are no release commits to merge or rebase around.
- **Pre-1.0 semver:** breaking changes bump the minor (`0.1.0` → `0.2.0`),
  everything else bumps the patch.
- `@aspicio/react` depends on core as `workspace:^`, which `bun publish`
  rewrites to `^<version>` — consumers can patch-update core
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
cd ../react && bun publish --access public --dry-run
```

## Verifying a release

```bash
npm view @aspicio/core version           # the new version is live
npm view @aspicio/react dependencies     # core range is ^<version>
```

Then the real proof: `npm install @aspicio/react` in a scratch app and
render a drawing.

## When things go wrong

- **The gate fails** — nothing was published; fix the failure on `main`,
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
field. `three` and `dxf-parser` are regular dependencies; `react` is a
peer. Check the exact contents any time with `bun pm pack` in the package
directory.
