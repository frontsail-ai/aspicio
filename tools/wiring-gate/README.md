# @aspicio/wiring-gate

Proves that cross-workspace imports work for a reason other than "this
repo happens to be wired that way".

## Why this exists

The bundle gate (`tools/bundle-gate/`) resolves packages through
`node_modules` and their published `exports` maps, deliberately without
aliases, so it proves what a **published consumer** bundles (INV-11).

It is blind to the opposite failure: an import that resolves only
because a `tsconfig` path or a Vite alias rewrote it. That axis has cost
five incidents.

- Four during the format seam: a string alias matches prefixes and first
  match wins, so a missing subpath entry let `@aspicio/core/pdf` resolve
  to `.../core/src/index.ts/pdf`. Each consumer needs the subpath alias
  listed **before** the bare one, in both the tsconfig and the Vite
  config.
- One when the shared MCP tool table lived inside `@aspicio/mcp` and was
  imported as `@aspicio/mcp/tools-meta`. That package has no `exports`
  map and ships `files: ["dist"]`, so `require.resolve` answered
  `MODULE_NOT_FOUND` while every in-repo build succeeded. The Vercel
  deploy config for `apps/api` carries no aliases on purpose, so a
  deploy and a test run resolved the same specifier by different routes.

## What it asserts

1. **Every `@aspicio/*` import in first-party source names a subpath the
   target package exports.** The `exports` map is the one declaration
   every resolution route agrees on, so it is the one the gate reads.
   Aliases may exist for speed or source-vs-dist reasons; they may not
   be load-bearing.
2. **The shared agent-tool table imports nothing but zod**, and declares
   nothing else as a dependency. Both MCP surfaces read it and one is a
   deployed HTTP service, so anything it reaches for lands in that
   service's graph.

Both assertions were verified red before being committed: reintroducing
the `@aspicio/mcp/tools-meta` import fails (1), and adding a `three`
import to the table fails (2).

## What it does not do

It reads source text and manifests; it does not build. That keeps it in
the `check`/`test` phase rather than the `build` phase, and it is why the
gate has no `@aspicio/*` aliases of its own — an alias here would let it
resolve the very imports it exists to reject.
