# Releasing

Publishing is one command: push a version tag and CI does the rest.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The [publish workflow](../.github/workflows/publish.yml) then re-runs the
lint/test gate, stamps `0.1.0` into the package manifests, builds, and
publishes `@aspicio/core`, `@aspicio/elements`, `@aspicio/react`,
`@aspicio/vue`, `@aspicio/svelte`, and `@aspicio/mcp`.

## Release workflow

Tags are cut from the current tip of `master` — never from a branch or an
older commit. Follow these steps in order; each gates the next.

0. **Wait for pending PRs.** If any open PR belongs in the release —
   features, fixes, or (easy to miss) changes to the publish workflow
   itself — it merges first. A release cut around an unmerged PR silently
   ships without it: v0.4.0 nearly shipped without `@aspicio/mcp` because
   the PR wiring it into publishing was still open.

1. **Analyze the changes.** Diff the published packages since the last
   tag and read what actually changed:

   ```bash
   LAST=$(git tag --list 'v*' --sort=-v:refname | head -1)
   git log --oneline "$LAST"..HEAD
   git diff --name-only "$LAST"..HEAD -- packages/   # which published pkgs moved
   ```

   Only `packages/*` feed the npm semver — `apps/*` (demo, api, widget)
   ship on the website, not to npm, so a demo-only change doesn't move the
   library version (but still belongs in the release notes).

2. **Decide the release type** per the [versioning policy](#versioning-policy):
   patch for fix-only changes to published packages, minor for a public-API
   addition or feature batch (or a breaking change, pre-1.0). **If the
   change set is ambiguous — a fix that also widened a type, a refactor
   with a subtle behavior change, unsure whether something is "public API"
   — stop and ask the user which bump to cut, and state your recommendation
   with the one-line reason.** Don't silently pick when it's a judgment
   call; do pick (and just say so) when it's clear-cut.

3. **Open the release PR.** Bump `server.json`'s top-level and package
   `version` fields (they're pinned — the registry has no workspace
   stamping, INV-9) in a small `chore(release): X.Y.Z` PR. Never push the
   bump straight to `master` — v0.8.0 did, and "where is the PR?" is why
   this sentence exists.

4. **Wait for CI to go green.** All required checks must pass on the PR
   before merging (`gh pr checks <n> --watch`). Don't merge a yellow PR —
   the same gate runs again in the publish workflow, so a red check here
   is a guaranteed failed release.

5. **Merge the PR** (`gh pr merge <n> --merge`).

6. **Pull the latest master.** `git fetch && git checkout master &&
git pull`; confirm the working tree is clean and local `master` matches
   `origin/master`. The merge commit is the tip you'll tag.

7. **Tag that merge commit and push the tag.**

   ```bash
   git tag vX.Y.Z <merge-commit> && git push origin vX.Y.Z
   ```

8. **Wait for the publish workflow to succeed.** Pushing the tag triggers
   [publish.yml](../.github/workflows/publish.yml); watch it to completion
   (`gh run watch <id> --exit-status`) — it re-runs the gate, stamps the
   version, publishes all six packages, republishes the MCP registry
   listing (OIDC), and creates the GitHub Release. If it fails, see
   [When things go wrong](#when-things-go-wrong) before re-tagging. Then
   verify and curate the Release (next two sections).

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
  `@aspicio/elements`, `@aspicio/react`, `@aspicio/vue`,
  `@aspicio/svelte`, and `@aspicio/mcp` always release together with the
  same number (INV-9).
  Revisit (e.g. with changesets) only if their release cadences genuinely
  diverge.
- **The tag is the source of truth.** Manifests in the repo stay at
  `0.0.0`; the workflow stamps the tag's version at publish time. There
  are no release commits to merge or rebase around.
- **Pre-1.0 semver:** feature batches bump the minor (`0.1.0` → `0.2.0`) —
  the practice every release so far has followed — and fix-only releases
  bump the patch. Breaking changes also bump the minor, called out in the
  release notes.
- `@aspicio/elements` depends on core — and the React, Vue, and Svelte
  bindings on both — as `workspace:^`, which the publish workflow
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
cd ../svelte && bun publish --access public --dry-run
cd ../mcp && bun publish --access public --dry-run
```

## After the tag: the GitHub Release

The workflow creates the GitHub Release automatically (generated notes,
non-dry-run tag pushes only). Two follow-ups are on whoever cuts the
release:

1. **Verify it exists**: `gh release view vX.Y.Z`. A tag without a
   Release is invisible on GitHub — v0.7.0 and v0.8.0 both shipped
   without one until backfilled.
2. **Curate the notes**: replace the generated list with a short
   narrative in the house style (`gh release edit vX.Y.Z --notes-file …`)
   — headline sentence, grouped sections with PR references, and the
   Install footer listing every package at the new version. Past
   releases are the template.

## Verifying a release

```bash
npm view @aspicio/core version           # the new version is live
npm view @aspicio/elements dependencies  # core range is ^<version>
npm view @aspicio/react dependencies     # elements + core ranges are ^<version>
npm view @aspicio/vue dependencies       # same for the Vue bindings
npm view @aspicio/svelte dependencies    # same for the Svelte bindings
npm view @aspicio/mcp dependencies       # same for the MCP server
npx -y @aspicio/mcp </dev/null           # the agent entry point resolves
gh release view vX.Y.Z                   # the GitHub Release exists
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
field. The exception is `@aspicio/svelte`, which ships raw `src/`
(`.svelte` + hand-written types) via the `svelte` export condition and
has no build step. `three` and `dxf-parser` are regular dependencies, as is `lit` in
`@aspicio/elements`; `react`, `vue`, and `svelte` are peers of their
bindings.
Check the exact contents any time with `bun pm pack` in the package
directory.
