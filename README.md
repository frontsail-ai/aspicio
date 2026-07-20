<div align="center">
  <img src="apps/demo/public/favicon.svg" width="72" height="72" alt="Aspicio logo" />
  <h1>Aspicio</h1>
  <p><em>Aspicio</em> (Latin: "I look at") — a TypeScript-first 2D DXF viewer for the web.</p>
  <p><a href="https://aspicio.dmitri-66a.workers.dev"><strong>▶ Live demo</strong></a></p>
</div>

- WebGL rendering (Three.js) with batched geometry — one draw call per
  layer, large drawings stay interactive
- Broad entity coverage — lines, arcs, circles, ellipses, polylines (with
  bulges), splines, TEXT/MTEXT, DIMENSION, SOLID/HATCH fills, and nested
  INSERT blocks; anything unsupported is counted and reported, never fatal
- Layer list with visibility toggles, hover highlight (3× fat lines),
  double-click solo, and effective colors (what's actually drawn, not
  just the layer table)
- Pan, zoom, rotate, animated fit-to-view — mouse and multi-touch
  (pinch zoom, twist rotate) are equally first-class
- Tools: distance/area measure with object snap, click-to-select with an
  entity info panel, and keyboard shortcuts
- SVG (vector) and PNG export, paper-space layouts, and both ASCII and
  binary DXF
- Hit-testing (`pickLayer`), camera state access, extensible
  entity-handler registry

Out of scope for now: editing and 3D.

<img src="docs/sample-demo.png" alt="Aspicio viewing a sample floor-plan DXF — layer panel, colored geometry, text, and a dimension" />

## Packages

| Package                            | Description                                                         |
| ---------------------------------- | ------------------------------------------------------------------- |
| [`@aspicio/core`](packages/core)   | The viewer library: parsing, tessellation, rendering, camera, input |
| [`@aspicio/react`](packages/react) | React bindings: `<DxfEmbed>`, `<DxfPreview>`, `<DxfLayerPanel>`     |
| [`@aspicio/mcp`](packages/mcp)     | MCP server for AI agents: `describe_dxf` + `render_dxf`             |
| [`@aspicio/api`](apps/api)         | DXF HTTP API Worker (private): `/describe`, `/render`               |
| [`@aspicio/demo`](apps/demo)       | Standalone demo app (private) — also the reference integration      |

## Quick start

React (one component — layer list + interactive preview):

```tsx
import { DxfEmbed } from "@aspicio/react";

<DxfEmbed src={file} style={{ height: 480 }} />;
```

Vanilla:

```ts
import { DxfViewer } from "@aspicio/core";

const viewer = new DxfViewer(document.querySelector("#preview")!);
await viewer.load(file); // File | Blob | ArrayBuffer | DXF text
```

See each package's README for the full API.

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

CI runs the same gates on every PR, plus a smoke suite against the
production build ([ci.yml](.github/workflows/ci.yml)). Pushes to `master`
deploy the demo and the DXF API to Cloudflare Workers, and every PR gets
preview URLs posted back as comments
([deploy.yml](.github/workflows/deploy.yml)).

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
WebGL context); the e2e suite exercises it end to end instead.

## Releasing

```bash
git tag v0.1.0 && git push origin v0.1.0
```

CI gates, versions, builds, and publishes both public packages. Full
runbook — one-time npm setup, versioning policy, dry runs, recovery —
in [docs/releasing.md](docs/releasing.md).
