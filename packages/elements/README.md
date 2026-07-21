# @aspicio/elements

Framework-neutral web components for the
[Aspicio](https://github.com/frontsail-ai/aspicio#readme) DXF viewer.
One implementation of the embed UI, consumable from plain HTML, Vue,
Svelte — and React via [`@aspicio/react`](../react), which is a thin
veneer over these elements.

```bash
npm install @aspicio/elements three   # @aspicio/core and lit come along; three (>=0.184) is a peer
```

- `<aspicio-embed>` — batteries included: layer list + interactive preview
  in one tag.
- `<aspicio-preview>` — the embeddable canvas alone: pan/zoom/rotate
  (mouse and multi-touch), animated fit, batched WebGL rendering. No
  chrome. Set the `hover-pick` attribute to hit-test the layer under the
  cursor.
- `<aspicio-layer-panel>` — the ready-made layer list, identical to the
  demo app: header with layer count, visibility checkboxes,
  effective-color swatches, entity counts, hover-to-highlight,
  double-click-to-solo (with a banner), and a gesture-hints footer.
  `theme="none"` renders a minimal list.

## One tag

```html
<script type="module">
  import "@aspicio/elements"; // registers the elements
</script>

<aspicio-embed src-url="/drawing.dxf" style="height: 480px"></aspicio-embed>
```

Attributes: `src-url`, `panel` (`left` | `right` | `none`), `theme`
(`aspicio` | `none`), `no-download`, `shortcuts`. Rich data goes through
properties: `src` (DXF text | File | Blob | ArrayBuffer), `options`
(viewer options), `panelStyle` (style object applied to the inner
panel). The readonly `viewer` property exposes the full `DxfViewer`.

Events (all `CustomEvent`s dispatched on the element):

| Event           | `detail`            | Fires                                           |
| --------------- | ------------------- | ----------------------------------------------- |
| `loaded`        | `{ layers, stats }` | after each successful load                      |
| `load-error`    | `{ error }`         | when a load fails                               |
| `viewer-change` | `{ viewer }`        | when the viewer is created (null on disconnect) |
| `hover-layer`   | `{ layer }`         | layer under the cursor, or null (`hover-pick`)  |

## Vue

Custom elements are first-class in Vue — tell the compiler about the
`aspicio-` tags ([Vue docs](https://vuejs.org/guide/extras/web-components))
and use the elements directly:

```js
// vite.config.js
export default {
  plugins: [
    vue({
      template: {
        compilerOptions: { isCustomElement: (tag) => tag.startsWith("aspicio-") },
      },
    }),
  ],
};
```

```vue
<script setup>
import "@aspicio/elements";
const onLoaded = (e) => console.log(e.detail.stats);
</script>

<template>
  <aspicio-embed src-url="/drawing.dxf" style="height: 480px" @loaded="onLoaded" />
</template>
```

Vue binds attributes for primitives and DOM properties for rich values
automatically — `:src="file"` and `:options="{ background: 0x16181d }"`
just work.

## Svelte

Svelte consumes custom elements natively:

```svelte
<script>
  import "@aspicio/elements";
</script>

<aspicio-embed
  src-url="/drawing.dxf"
  style="height: 480px"
  onloaded={(e) => console.log(e.detail.stats)}
></aspicio-embed>
```

## Theming

The elements render in shadow DOM, so host-page CSS can't accidentally
restyle their internals — and every integration looks pixel-identical.
Deliberate theming has two hooks:

- **Design tokens** as CSS custom properties (they inherit, so set them
  on the element or any ancestor):

  ```css
  aspicio-embed {
    --aspicio-crease: #ff5c8a; /* accent */
    --aspicio-panel: #101216;
  }
  ```

  The full token list ships as the `aspicioTokens` export.

- **Parts** for structural styling: `::part(panel)`, `::part(header)`,
  `::part(row)`, `::part(checkbox)`, `::part(swatch)`, `::part(name)`,
  `::part(count)`, `::part(hints)`, `::part(solo-banner)`,
  `::part(canvas-host)`, `::part(download)`.

The theme uses IBM Plex font _stacks_ but never loads webfonts itself
(no surprise network requests from a library). Load IBM Plex Sans/Mono
in your page for the exact demo typography; otherwise system faces are
used.

## Notes

- The `viewer` property (also delivered by `viewer-change`) is the full
  `@aspicio/core` API — `fitView`, `zoomBy`, `resetRotation`,
  `setLayerVisible`, `setLayerHighlight`, `pickLayer`, `view`, `stats`,
  `toSVG`, `toPNG`.
- Changing `src` / `src-url` loads the new document; the most recently
  set source wins (if both are set at creation, `src-url` does), and
  stale in-flight loads are ignored.
- `shortcuts` keys are scoped to the **focused** embed (click it first):
  `F` fit, `+`/`-` zoom, `R` reset rotation, `A` show all layers —
  multiple embeds on a page don't collide.
- Removing an element disposes its WebGL viewer; re-inserting it starts
  a fresh one and reloads the current source.
- Importing the package registers the elements as a side effect; the
  module is safe to import in SSR (Node) environments — the viewer is
  only created in the browser. See `apps/elements-example` for a full
  setup.
