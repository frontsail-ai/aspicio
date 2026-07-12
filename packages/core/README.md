# @aspicio/core

A TypeScript-first 2D DXF viewer for the web: WebGL rendering, layers,
and mobile-grade gestures behind one small facade. Framework-agnostic —
React bindings live in
[`@aspicio/react`](https://github.com/frontsail-ai/aspicio/tree/main/packages/react#readme).

```bash
npm install @aspicio/core three   # three is a peer dependency (>=0.184)
```

```ts
import { DxfViewer } from "@aspicio/core";

const viewer = new DxfViewer(container, { background: 0x16181d });
await viewer.load(file); // File | Blob | ArrayBuffer | DXF text
```

That alone gives you an interactive preview inside `container`: drag to
pan, wheel/pinch to zoom (cursor-anchored), Shift+drag or two-finger
twist to rotate, double click/tap for an animated fit. The viewer owns
its canvas, tracks container resizes, and renders on demand.

## API overview

### Loading

| Member         | Notes                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `load(src)`    | `File \| Blob \| ArrayBuffer \| string` (DXF text)                                                 |
| `loadUrl(url)` | fetch + load; rejects on HTTP errors                                                               |
| `document`     | the parsed, normalized `DxfDocument` (or `null`)                                                   |
| `stats`        | `{ entityCount, segmentCount, unsupported }` — unsupported is a per-type count of skipped entities |

### Layers

| Member                            | Notes                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getLayers()`                     | `LayerInfo[]`: `name`, `color` (layer-table RGB), `effectiveColors` (colors actually drawn, dominant first — prefer `effectiveColors[0]` for UI), `visible`, `frozen`, `entityCount` |
| `setLayerVisible(name, visible)`  | flag flip on batched geometry — O(1)                                                                                                                                                 |
| `setLayerHighlight(name \| null)` | draws that layer with fat lines on top                                                                                                                                               |
| `pickLayer(x, y, tolerancePx?)`   | hit-test canvas CSS-pixel coords → layer name or `null`; pure math, no GPU readback                                                                                                  |

### Selection & measurement

| Member                           | Notes                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pickEntity(x, y, tolerancePx?)` | hit-test → `{ index, entity, info, layer }` or `null`; edges win within tolerance, else a filled interior under the cursor |
| `setSelection(index \| null)`    | draw a bright overlay on one entity (its lines and any fill) by its `document.entities` index                              |
| `screenToWorld(x, y)`            | canvas CSS-pixel coords → world (drawing) coordinates                                                                      |
| `worldToScreen(point)`           | world coordinates → canvas CSS-pixel coords (place labels, rulers, measure overlays)                                       |

`describeEntity(entity)` (a free function) summarizes any entity as
`{ type, layer, color, length?, radius?, area?, points?, position?, text? }`
for an info panel — reused by the demo and the React bindings.

### Camera

| Member                               | Notes                                                    |
| ------------------------------------ | -------------------------------------------------------- |
| `fitView({ animate?, durationMs? })` | fit the whole drawing; eased when animated               |
| `zoomBy(factor, { animate? })`       | `>1` zooms in, anchored at the viewport center           |
| `resetRotation({ animate? })`        | back to 0°, keeping center and zoom                      |
| `view`                               | read-only `{ center, unitsPerPixel, rotation }` snapshot |

User gestures cancel any running camera animation.

### Events & lifecycle

```ts
viewer.on("loaded", () => rebuildMyLayerPanel());
viewer.on("render", () => updateZoomIndicator(viewer.view));
viewer.dispose(); // release the WebGL context and listeners
```

### Options

```ts
new DxfViewer(container, {
  background: 0x16181d, // 24-bit RGB, or null for a transparent canvas
  curveSegments: 72, // arc flattening resolution (segments per full circle)
});
```

## Supported entities

LINE, LWPOLYLINE/POLYLINE (including bulge arcs), CIRCLE, ARC, ELLIPSE,
nested INSERT (block references with transforms, ByBlock color
inheritance, and the layer-0 rule), TEXT and MTEXT (rendered with a
built-in single-stroke vector font; MTEXT formatting codes are
collapsed to plain text), SPLINE (B-spline sampled to a polyline),
SOLID/TRACE/3DFACE and solid HATCH (filled polygons, holes honored;
pattern HATCH falls back to its boundary outline), POINT (crosshair
marker), and DIMENSION (its anonymous block is expanded, so dimension
lines, arrowheads, and the measurement text all draw). Everything else
is skipped, counted in `stats.unsupported`, and never breaks the load.

Linetypes from the LTYPE table are honored: dashed/hidden/center
patterns are dashed in drawing units (an entity's linetype, or its
layer's). Lineweights (group 370) render at width: segments are grouped
by weight and drawn with fat lines, so bold outlines read as bold.
Colors resolve like CAD expects: per-entity overrides beat
ByLayer, and `effectiveColors` reports what actually reached the
screen — important
for CAM/die-cutting exports that color every entity and leave the layer
table blank-white.

## Extending

The pipeline is `parseDxf → tessellate → render`, and each stage is
exported. Add or override an entity type with one handler — no pipeline
surgery:

```ts
import { registerEntityHandler } from "@aspicio/core";

registerEntityHandler("ELLIPSE", (entity, ctx) => {
  ctx.addPolyline(myFancierSampling(entity));
});
```

`parseDxf`, `tessellate`, `pickLayer`, `Camera2D`, and `attachGestures`
are usable stand-alone for custom renderers.

## Notes

- Geometry is re-centered around the drawing bounds before GPU upload, so
  georeferenced files with huge coordinates don't jitter under float32.
- Bundle cost: Three.js (~150 kB gzipped). It's a **peer dependency**, so
  your app owns the single `three` instance — no duplicate copies when
  other three-based libraries share the tree.

## Development

```bash
vp install   # dependencies
vp test      # unit tests
vp pack      # build dist/
```
