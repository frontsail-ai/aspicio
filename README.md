# Aspicio

_Aspicio_ (Latin: "I look at") — a TypeScript-first DXF viewer.

- WebGL rendering (Three.js) with an extensible entity pipeline
- Layer listing and visibility toggling
- Pan, zoom, and rotate — mobile gestures are first-class
- Usable as a library (`@aspicio/core`) or as a standalone app (`@aspicio/demo`)

Out of scope for now: editing, 3D.

<img width="1543" height="756" alt="Screenshot 2026-07-11 at 23 06 21" src="https://github.com/user-attachments/assets/60d5487b-b090-4379-9189-703b63805bfd" />


## Packages

| Package                          | Description                                                         |
| -------------------------------- | ------------------------------------------------------------------- |
| [`@aspicio/core`](packages/core) | The viewer library: parsing, tessellation, rendering, camera, input |
| [`@aspicio/demo`](apps/demo)     | Standalone demo app (layer panel, file loading)                     |

## Development

Toolchain: [Vite+](https://viteplus.dev) (`vp`) on top of bun.

```bash
vp install       # install dependencies
vp run dev       # start the demo app
vp check         # format, lint, type-check
vp run -r test   # run all unit tests
vp run e2e       # run browser e2e tests (Playwright)
vp run ready     # check + test + build everything
```

## Releasing

Publishing to npm is automated by
[`.github/workflows/publish.yml`](.github/workflows/publish.yml). Both
public packages (`@aspicio/core`, `@aspicio/react`) share one version.

```bash
git tag v0.1.0 && git push origin v0.1.0   # gate → version → publish
```

The workflow re-runs lint and unit tests, stamps the tag's version into
the package manifests, builds, and publishes core before react (bun
rewrites the `workspace:^` dependency to `^<version>`). A manual
`workflow_dispatch` run supports a dry-run mode. Requires the
`NPM_TOKEN` repository secret (an npm automation token with publish
rights to the `@aspicio` scope).

## Testing

- **Unit tests** (`packages/core/tests/`, Vitest): parsing, geometry math,
  tessellation, camera invariants, gestures (happy-dom), and the viewer facade
  (mocked renderer). `vp test --coverage` inside `packages/core` reports 100%
  line coverage for every module except `render/renderer.ts`.
- **E2E tests** (`apps/demo/e2e/`, Playwright): real-browser coverage of the
  WebGL renderer and the demo app — pixel-level render checks, layer toggling,
  zoom/pan/rotate/fit, synthetic multi-touch pinch and twist, file picker,
  drag & drop, error handling, and the mobile layout.

The renderer is intentionally untested at the unit level (it needs a real
WebGL context); the e2e suite exercises it end to end instead.
