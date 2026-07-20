<div align="center">
  <img src="apps/demo/public/favicon.svg" width="72" height="72" alt="Aspicio logo" />
  <h1>Aspicio</h1>
  <p><strong>DXF understanding for people, applications, and AI agents.</strong></p>
  <p><em>Aspicio</em> (Latin: "I look at")</p>
  <p>
    <a href="https://github.com/frontsail-ai/aspicio/actions/workflows/ci.yml"><img src="https://github.com/frontsail-ai/aspicio/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://www.npmjs.com/package/@aspicio/core"><img src="https://img.shields.io/npm/v/%40aspicio%2Fcore?label=%40aspicio%2Fcore" alt="npm: @aspicio/core" /></a>
    <a href="https://www.npmjs.com/package/@aspicio/react"><img src="https://img.shields.io/npm/v/%40aspicio%2Freact?label=%40aspicio%2Freact" alt="npm: @aspicio/react" /></a>
    <a href="https://www.npmjs.com/package/@aspicio/mcp"><img src="https://img.shields.io/npm/v/%40aspicio%2Fmcp?label=%40aspicio%2Fmcp" alt="npm: @aspicio/mcp" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  </p>
  <p><a href="https://aspicio.dmitri-66a.workers.dev"><strong>▶ Live demo</strong></a></p>
</div>

Aspicio is an open-source (MIT), TypeScript-first DXF engine: one
framework-free `parse → tessellate` pipeline that runs in the browser, in
Node, and in Cloudflare Workers. A person gets an interactive WebGL viewer
of a CAD drawing; an AI agent gets structured JSON facts and a rendered
PNG of the same file. Every surface — the browser viewer, the React
components, the headless renderer, the HTTP API, and the MCP server — is
a thin adapter over the same engine, so a drawing is equally readable
everywhere.

```
DXF bytes ──parse──▶ DxfDocument ──tessellate──▶ Tessellation ──┬─▶ WebGL renderer (viewer)
              (normalized model)      (batched geometry)        ├─▶ SVG string (export / API / MCP)
                                                                └─▶ DrawingSummary (describe)
```

How it's built: [docs/architecture.md](docs/architecture.md) · behavior
specs: [docs/product-specs/](docs/product-specs/README.md)

<img src="docs/sample-demo.png" alt="Aspicio viewing a sample floor-plan DXF — layer panel, colored geometry, text, and a dimension" />

## Embed it

React — one component gives you the layer panel plus an interactive
preview:

```tsx
import { DxfEmbed } from "@aspicio/react";

<DxfEmbed src={file} style={{ height: 480 }} />;
```

Vanilla TypeScript:

```ts
import { DxfViewer } from "@aspicio/core";

const viewer = new DxfViewer(document.querySelector("#preview")!);
await viewer.load(file); // File | Blob | ArrayBuffer | DXF text (ASCII or binary)
```

Headless — parse, describe, and render with no browser at all (Node or
Workers; server-side previews, thumbnails, pipelines):

```ts
import { parseDxfBytes, tessellate, describeDrawing, tessellationToSvg } from "@aspicio/core";

const doc = parseDxfBytes(bytes); // ASCII or binary DXF
const drawing = tessellate(doc);
const summary = describeDrawing(doc, drawing); // units, bounds, layers, texts…
const svg = tessellationToSvg(drawing);
```

What you get: WebGL rendering batched to one draw call per layer (large
drawings stay interactive), broad entity coverage (lines, arcs, circles,
ellipses, polylines with bulges, splines, TEXT/MTEXT, DIMENSION,
SOLID/HATCH fills, nested INSERT blocks — anything unsupported is counted
and reported, never fatal), a layer list with the colors that are
_actually drawn_ rather than the often-meaningless layer table, measure
with object snap, entity picking, paper-space layouts, SVG/PNG export,
and first-class touch. Out of scope: editing and 3D.

## Hand it to an agent

The same engine speaks MCP and HTTP, so an agent can _read_ a drawing
instead of guessing at it:

- **`describe_dxf`** — units, bounds, size, layers with effective colors,
  entity counts, and the drawing's text content. An agent reads a title
  block or a dimension value directly — no OCR, no vision round-trip.
- **`render_dxf`** — a PNG of the drawing the model can look at.

| Surface                                               | Local files | URLs | Inline DXF |
| ----------------------------------------------------- | ----------- | ---- | ---------- |
| stdio MCP — `npx -y @aspicio/mcp`                     | ✅          | ✅   | ✅         |
| Hosted MCP — `aspicio-api.dmitri-66a.workers.dev/mcp` | —           | ✅   | ✅         |
| HTTP API — `/describe`, `/render`                     | POST body   | ✅   | ✅         |

Connect:

- **Claude Code** — one step installs the MCP server plus the bundled
  skills (`aspicio-inspect-dxf`, `aspicio-embed`):
  `/plugin marketplace add frontsail-ai/aspicio` then `/plugin install aspicio@aspicio`
- **Codex** — the same repo doubles as a Codex marketplace:
  `codex plugin marketplace add https://github.com/frontsail-ai/aspicio`,
  `codex plugin add aspicio@aspicio`, then
  `codex mcp add aspicio -- npx -y @aspicio/mcp`
- **Any client that launches stdio MCP servers** — register
  `npx -y @aspicio/mcp`
- **Any client that takes remote MCP connectors** — point it at
  `https://aspicio-api.dmitri-66a.workers.dev/mcp` (Streamable HTTP,
  no install)
- **Plain HTTP** — `GET /describe?src=<dxf-url>`,
  `GET /render?src=<dxf-url>&format=png|svg`; the API self-describes at
  [`/openapi.json`](https://aspicio-api.dmitri-66a.workers.dev/openapi.json)

URL fetches are guarded (private-network blocking, size caps, redirect
validation, timeouts), and the stdio server keeps local files local.

## Available today · direction

Everything above is shipped and live: viewer + demo, React and core
packages, headless describe/render, stdio and hosted MCP, the HTTP API
with OpenAPI, and plugin packaging for Claude Code and Codex.

Direction (intent, not commitments — see
[issues](https://github.com/frontsail-ai/aspicio/issues)): MCP registry
listings, an in-chat viewer for conversational clients (MCP Apps),
structured entity queries and focused rendering, and an upload flow so
remote surfaces can handle local files.

## Packages

| Package                            | Description                                                         |
| ---------------------------------- | ------------------------------------------------------------------- |
| [`@aspicio/core`](packages/core)   | The viewer library: parsing, tessellation, rendering, camera, input |
| [`@aspicio/react`](packages/react) | React bindings: `<DxfEmbed>`, `<DxfPreview>`, `<DxfLayerPanel>`     |
| [`@aspicio/mcp`](packages/mcp)     | MCP server for AI agents: `describe_dxf` + `render_dxf`             |
| [`@aspicio/api`](apps/api)         | DXF HTTP API Worker (private): `/describe`, `/render`, `/mcp`       |
| [`@aspicio/demo`](apps/demo)       | Standalone demo app (private) — also the reference integration      |

## Development

Toolchain: [Vite+](https://viteplus.dev) (`vp`) on top of bun.

```bash
vp install       # install dependencies
vp run dev       # start the demo app
vp run ready     # check + test + build everything (the repo gate)
```

Testing, CI/deploy, releasing, and contribution guidance:
[CONTRIBUTING.md](CONTRIBUTING.md).
