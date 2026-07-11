# Observo

_Observo_ (Latin: "I watch") — a TypeScript-first DXF viewer.

- WebGL rendering (Three.js) with an extensible entity pipeline
- Layer listing and visibility toggling
- Pan, zoom, and rotate — mobile gestures are first-class
- Usable as a library (`@observo/core`) or as a standalone app (`@observo/demo`)

Out of scope for now: editing, 3D.

## Packages

| Package                          | Description                                                         |
| -------------------------------- | ------------------------------------------------------------------- |
| [`@observo/core`](packages/core) | The viewer library: parsing, tessellation, rendering, camera, input |
| [`@observo/demo`](apps/demo)     | Standalone demo app (layer panel, file loading)                     |

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
