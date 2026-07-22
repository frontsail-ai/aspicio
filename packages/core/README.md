# @aspicio/core

A TypeScript-first 2D DXF viewer for the web: WebGL rendering, layers,
and mobile-grade gestures behind one small facade. Framework-agnostic —
React bindings live in
[`@aspicio/react`](https://github.com/frontsail-ai/aspicio/tree/master/packages/react#readme).
Try the viewer live at [aspicio.frontsail.app](https://aspicio.frontsail.app/).

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
| `load(src)`    | `File \| Blob \| ArrayBuffer \| string` — ASCII **or** binary DXF (auto-detected from bytes)       |
| `loadUrl(url)` | fetch + load; rejects on HTTP errors                                                               |
| `document`     | the parsed, normalized `DxfDocument` (or `null`)                                                   |
| `stats`        | `{ entityCount, segmentCount, unsupported }` — unsupported is a per-type count of skipped entities |

Both DXF encodings load transparently: text and "AutoCAD Binary DXF" (R12
1-byte and R13+ 2-byte code variants). If you parse bytes yourself,
`isBinaryDxf(bytes)` and `binaryDxfToText(bytes)` are exported to feed the
binary form into `parseDxf`.

### Layers

| Member                            | Notes                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getLayers()`                     | `LayerInfo[]`: `name`, `color` (layer-table RGB), `effectiveColors` (colors actually drawn, dominant first — prefer `effectiveColors[0]` for UI), `visible`, `frozen`, `entityCount` |
| `setLayerVisible(name, visible)`  | flag flip on batched geometry — O(1)                                                                                                                                                 |
| `setLayerHighlight(name \| null)` | draws that layer with fat lines on top                                                                                                                                               |
| `pickLayer(x, y, tolerancePx?)`   | hit-test canvas CSS-pixel coords → layer name or `null`; pure math, no GPU readback                                                                                                  |

### Selection & measurement

| Member                           | Notes                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pickEntity(x, y, tolerancePx?)` | hit-test → `{ index, entity, info, layer }` or `null`; edges win within tolerance, else a filled interior under the cursor  |
| `setSelection(index \| null)`    | draw a bright overlay on one entity (its lines and any fill) by its `document.entities` index                               |
| `snap(x, y, tolerancePx?)`       | object-snap → `{ point, kind }` (`endpoint`/`node`/`center`/`midpoint`) or `null`; only visible layers; built once per load |
| `screenToWorld(x, y)`            | canvas CSS-pixel coords → world (drawing) coordinates                                                                       |
| `worldToScreen(point)`           | world coordinates → canvas CSS-pixel coords (place labels, rulers, measure overlays)                                        |

`describeEntity(entity)` (a free function) summarizes any entity as
`{ type, layer, color, length?, radius?, area?, points?, position?, text? }`
for an info panel — reused by the demo and the React bindings.

### Export

| Member                   | Notes                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `toSVG({ background? })` | the whole drawing as a standalone SVG string (vector, visible layers only, lineweights → `stroke-width`) |
| `toPNG({ background? })` | the current view (WYSIWYG) as a PNG data URL at native resolution; `background` fills behind the drawing |

`document.units` carries the short unit label from `$INSUNITS` (e.g.
`"mm"`, or `""` when unitless). `unitLabel(code)` and `niceLength(max)`
(a 1-2-5 round-number helper for scale bars) are exported too.

### Layouts (paper space)

| Member                 | Notes                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `getSpaces()`          | `["Model", ...layoutNames]` — model space plus any paper-space layouts                     |
| `setActiveSpace(name)` | switch the displayed space; re-tessellates, re-fits, re-renders. Unknown names are ignored |
| `activeSpaceName`      | the space currently shown (`"Model"` or a layout name)                                     |

A layout renders its own sheet geometry plus each viewport's model content,
transformed to the sheet scale and clipped to the window — all baked into
one paper-space tessellation (`tessellateLayout`). Entity picking is limited
to model space. `document.layouts` holds the parsed `Layout[]`.

### Camera

| Member                               | Notes                                             |
| ------------------------------------ | ------------------------------------------------- |
| `fitView({ animate?, durationMs? })` | fit the whole drawing; eased when animated        |
| `zoomBy(factor, { animate? })`       | `>1` zooms in, anchored at the viewport center    |
| `resetRotation({ animate? })`        | back to 0°, keeping center and zoom               |
| `view`                               | `{ center, unitsPerPixel, rotation }` snapshot    |
| `setView(view, { animate? })`        | restore a `view` snapshot (inverse of the getter) |

User gestures cancel any running camera animation.

`view` / `setView` round-trip a camera pose — the basis for shareable
"open at this view" deep links. `center` is in the drawing's internal
offset space, so a snapshot is meaningful only for the same document
(which is exactly what a per-drawing link needs). See the demo's
`viewurl.ts` for a URL-hash reference implementation.

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

Paper-space layouts are parsed too: model and paper geometry are kept
apart, and VIEWPORT entities frame the model at a set scale. A layout
draws its sheet plus each viewport's clipped, scaled model view — switch
with `setActiveSpace`.

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

`attachShortcuts(target, viewer, handlers)` adds keyboard shortcuts to a
window or element (returns a detach fn): `F` fit, `+`/`-` zoom, `R` reset
rotation drive the viewer directly; `M/A/I/H/C/?/Esc` delegate to
`handlers`. It ignores modifier combos, key repeat, and typing into form
fields.

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
