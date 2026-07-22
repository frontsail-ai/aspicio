# @aspicio/vue

Vue 3 bindings for the
[Aspicio](https://github.com/frontsail-ai/aspicio#readme) DXF viewer —
thin veneers over the framework-neutral
[`@aspicio/elements`](../elements) web components, so Vue, React,
Svelte, and plain-HTML embeds share one implementation and one look
(pixel-identical, verified). Try the viewer live at
[aspicio.frontsail.app](https://aspicio.frontsail.app/).

```bash
npm install @aspicio/vue vue three   # @aspicio/core and @aspicio/elements come along; vue 3.4+ and three (>=0.184) are peers
```

- `<DxfEmbed>` — batteries included: layer list + interactive preview in
  one component.
- `<DxfPreview>` — the embeddable canvas alone: pan/zoom/rotate (mouse
  and multi-touch), animated fit, batched WebGL rendering. No chrome.
  Bind `@hover-layer` to hit-test the layer under the cursor.
- `<DxfLayerPanel>` — the ready-made layer list, identical to the demo
  app: header with layer count, visibility checkboxes, effective-color
  swatches, entity counts, hover-to-highlight, double-click-to-solo
  (with a banner), and a gesture-hints footer. `theme="none"` renders a
  minimal list.

## One component

```vue
<script setup>
import { DxfEmbed } from "@aspicio/vue";

const onLoaded = ({ layers, stats }) => console.log(stats.entityCount);
</script>

<template>
  <!-- src also accepts File | Blob | ArrayBuffer | DXF text via :src -->
  <DxfEmbed src-url="/drawing.dxf" style="height: 480px" @loaded="onLoaded" />
</template>
```

Props: `src`, `src-url`, `panel` (`left` | `right` | `none`), `theme`
(`aspicio` | `none`), `panel-style`, `options`, `show-download`,
`shortcuts`. Emits: `loaded`, `load-error`, `viewer-change`,
`hover-layer` — payloads arrive unwrapped (no `CustomEvent.detail`
digging).

## The full viewer

The template ref exposes the complete `DxfViewer` — `fitView`, `zoomBy`,
`setLayerVisible`, `pickLayer`, `view`, `toSVG`, `toPNG`:

```vue
<script setup>
import { shallowRef, useTemplateRef } from "vue";

const embed = useTemplateRef("embed");
const fit = () => embed.value?.viewer?.fitView();
</script>

<template>
  <DxfEmbed ref="embed" src-url="/drawing.dxf" />
</template>
```

Prefer `shallowRef` when storing the viewer from `@viewer-change` —
the components unwrap reactive proxies defensively, but a deeply
reactive viewer buys nothing and costs proxy overhead.

## Custom layout

Compose `DxfPreview` + `DxfLayerPanel` yourself and hand the panel the
viewer from `@viewer-change`; `reverse-highlight-layer` wires
canvas-hover to the row highlight (the embed does this automatically).

## Theming

The internals render in shadow DOM. Theme through `--aspicio-*` CSS
custom properties and `::part()` hooks — see the
[`@aspicio/elements` README](../elements#theming) for the token and part
list. The theme uses IBM Plex font _stacks_ but never loads webfonts
itself; load IBM Plex Sans/Mono in your page for the exact demo look.

## Notes

- Changing `src` / `src-url` loads the new document; the most recently
  set source wins, and stale in-flight loads are ignored.
- `shortcuts` keys are scoped to the **focused** embed (click it first):
  `F` fit, `+`/`-` zoom, `R` reset rotation, `A` show all layers.
- SSR-safe (Nuxt): importing the package is fine in Node; the viewer is
  created only after client-side mount. See `apps/vue-example` for a
  full setup.
