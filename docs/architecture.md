# Architecture

## The pipeline in 30 seconds

```
DXF bytes ──parse──▶ DxfDocument ──tessellate──▶ Tessellation ──┬─▶ WebGL renderer (viewer)
              (normalized model)      (batched geometry)        ├─▶ SVG string (export / API / MCP)
                                                                └─▶ DrawingSummary (describe)
```

Every consumer — browser viewer, demo, React embed, HTTP API, MCP server —
sits on the same parse → tessellate core. The pipeline through SVG and
describe is **headless** (no DOM/WebGL): it runs in browsers, Node, and
Cloudflare Workers alike. Only the WebGL renderer needs a browser.

## Layers

| Layer           | Lives in                                                    | Why it exists                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse           | `packages/core/src/parse/`                                  | Turn messy DXF into one normalized document (layers, entities, blocks, layouts, units); count what it can't handle (INV-3)                                                                |
| Tessellate      | `packages/core/src/tessellate/`                             | Flatten entities into batched line/fill geometry, one accumulator per layer — one draw call per layer keeps huge drawings interactive. Extensible via the entity-handler registry (INV-6) |
| Render          | `packages/core/src/render/`                                 | Three.js/WebGL presentation of tessellation; render-on-demand only (INV-4)                                                                                                                |
| Viewer facade   | `packages/core/src/viewer.ts`                               | The one public object: load, camera, layers, picking, snap, export, events                                                                                                                |
| Input           | `packages/core/src/input/`                                  | Attachable, framework-free gesture + keyboard routers                                                                                                                                     |
| Bindings & apps | `packages/react/`, `apps/demo/`                             | UI opinion lives here, never in core (INV-1)                                                                                                                                              |
| Agent surface   | `apps/api/` (Worker), `packages/mcp/` (stdio)               | The same headless pipeline exposed over HTTP and MCP; shared guard semantics (INV-5)                                                                                                      |
| Packaging       | `skills/`, `.claude-plugin/`, `.codex-plugin/`, `.mcp.json` | One skills source consumed by both Claude Code and Codex plugin wrappers                                                                                                                  |

## Key technical assumptions

- **Offset space.** Geometry is re-centered around the drawing's midpoint
  for float precision; camera poses (`view`/`setView`) are in offset
  space, so snapshots are only meaningful per document (VIEW-3).
- **Color truth is the tessellation.** Per-layer segment-weighted color
  counts computed during tessellation feed every color display (INV-2).
- **Resolution order.** Dashes: entity → layer → continuous. Weights:
  entity → block override → layer → hairline. Block entities on layer "0"
  adopt the insert's layer.
- **Snap index is lazy** and typed-array-backed; built per loaded space on
  first use.
- **PNG without a GPU** is SVG rasterized by resvg — WASM in Workers,
  native in Node (MCP). Text renders as stroke paths, so rasterization
  needs no fonts.
- **Workspace resolution:** checks/tests resolve `@aspicio/core` from
  source (tsconfig `paths` + vite alias — both halves required, or CI
  breaks when `dist` is absent); wrangler and packs resolve the built
  dist, so deploys build core first.

## Tech choices

| Choice                       | Reason                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vite+ (`vp`) on bun          | One CLI for dev/build/test/lint/format; bun only as package manager/runtime backend                                    |
| Three.js                     | Batched WebGL lines/fills without hand-rolled GL; tree-shakes acceptably for headless use (ear-clipping only)          |
| dxf-parser + custom handlers | Battle-tested group-code parsing; HATCH/VIEWPORT and other gaps filled via our registry                                |
| Cloudflare Workers           | Static demo hosting and the API on the same infra; deploys via `wrangler` from GitHub Actions (status stays in the PR) |
| resvg                        | The one rasterizer with both WASM (Worker) and native (Node) builds producing identical output                         |
| MCP (stdio, official SDK)    | Vendor-neutral agent protocol — one server serves Claude, Codex, Cursor; contract-tested against the wire protocol     |

## Intentionally simple (for now)

- No editing, no 3D.
- Binary DXF is detected and rejected, not decoded (PARSE-2).
- UTF-8 only; pre-2007 ANSI code pages decode lossily.
- No auth/quotas on the API; SSRF guards + size caps are the perimeter.
- Deep links cover the demo's bundled sample only (DEMO-7).

## Migration paths

- Binary DXF decoding: a complete decoder exists on a parked branch;
  landing it upgrades PARSE-2 from "reject" to "parse".
- The URL-fetch guard is duplicated between API and MCP; consolidation
  into a shared core helper is the named follow-up (INV-5 stays the spec).
- A third Worker (or surface) slots into the deploy matrix and the plugin
  manifests without structural change.
