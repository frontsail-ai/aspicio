# Contributing to Aspicio

The full project guide — architecture, layout, conventions, and the
documentation index — lives in [AGENTS.md](AGENTS.md) (humans and coding
agents read the same file). This page covers the day-to-day mechanics.

## Setup and commands

Toolchain: [Vite+](https://viteplus.dev) (`vp`) on top of bun.

```bash
vp install       # install dependencies
vp run dev       # start the demo app
vp check         # format, lint, type-check
vp run -r test   # run all unit tests
vp run e2e       # run browser e2e tests (Playwright)
vp run ready     # check + test + build everything (the repo gate)
```

## Testing

- **Unit tests** (`packages/core/tests/`, `packages/react/tests/`,
  Vitest): parsing, geometry math, tessellation, camera invariants,
  gestures (happy-dom), the viewer facade (mocked renderer), and the
  React component lifecycle (mocked core).
- **E2E tests** (`apps/demo/e2e/`, Playwright): real-browser coverage of
  the WebGL renderer and the demo app — pixel-level render checks, layer
  toggling, zoom/pan/rotate/fit, synthetic multi-touch pinch and twist,
  file loading, error handling, and the mobile layout.

The renderer is intentionally untested at the unit level (it needs a real
WebGL context); the e2e suite exercises it end to end instead. All other
new logic ships with unit tests (INV-7).

## CI and deploys

CI runs the same gates on every PR, plus a smoke suite against the
production build ([ci.yml](.github/workflows/ci.yml)). Pushes to `master`
deploy the demo and the DXF API to Cloudflare Workers, and every PR gets
preview URLs posted back as comments
([deploy.yml](.github/workflows/deploy.yml)).

## Adding entity support

New DXF entity types go through the handler registry
(`registerEntityHandler`, INV-6) — no changes to the pipeline itself.
Check [docs/product-specs/parsing.md](docs/product-specs/parsing.md)
first; specs lead, and e2e fixtures must cover both ByLayer and
per-entity colors (INV-8).

## Releasing

```bash
git tag v0.5.0 && git push origin v0.5.0
```

CI gates, versions, builds, and publishes the three public packages
(`@aspicio/core`, `@aspicio/react`, `@aspicio/mcp`). Full runbook —
one-time npm setup, versioning policy, dry runs, recovery — in
[docs/releasing.md](docs/releasing.md).
