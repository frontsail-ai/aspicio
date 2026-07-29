# @aspicio/bundle-gate

The automated half of **INV-11**: a format's code reaches a consumer's bundle
only when that consumer imports the format's entry point.

Each fixture is a tiny app bundled with Vite. The test asserts on the built
output — the DXF sentinel string `AutoCAD Binary DXF` is present when the
fixture imports a format entry, and absent when it doesn't.

## Why it runs in the `build` phase, not `test`

The gate must resolve the packages the way a consumer does: through
`node_modules`, `exports` maps, and `sideEffects` — not through the source
aliases every other workspace uses in tests. The `sideEffects` field is the
thing most likely to break (a `false` there licenses a bundler to drop a
side-effect-only `formats/dxf` re-export), and it only applies to a published
package's files.

That means the gate needs the packages **built**. The repo gate runs
`vp check && vp run -r test && vp run -r build`, so tests run before any
`dist` exists — hence this workspace's `build` script runs the gate, after
its workspace dependencies have built.

## Two resolution paths, both guarded

The packages are consumed two ways, and each reads a different half of a
`sideEffects` field:

| Path                         | Resolves via               | Matches            |
| ---------------------------- | -------------------------- | ------------------ |
| Published consumer           | `node_modules` + `exports` | `./dist/formats/*` |
| In-repo app (demo, examples) | Vite source aliases        | `./src/formats/*`  |

A package that declares only the published half drops its side-effect-only
format module in every in-repo app — which is how four example apps once
built a viewer with no parser in it, passing every dev-server test and
failing only the production-build smoke. Both paths have fixtures here.

## Why the fixtures are not type-checked

Same reason, one step further: `vp check` runs before any build, so the
fixtures' `@aspicio/*` imports have nothing to resolve to on a clean tree —
exactly the CI-truth condition the repo gate enforces. They are excluded from
linting in the root `vite.config.ts` and from this workspace's tsconfig
program. Nothing is lost: a broken specifier fails the Vite build that the
gate runs, which is the only place it would matter.
