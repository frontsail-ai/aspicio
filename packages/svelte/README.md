# @aspicio/svelte

Svelte 5 bindings for the
[Aspicio](https://github.com/frontsail-ai/aspicio#readme) DXF viewer —
thin veneers over the framework-neutral
[`@aspicio/elements`](../elements) web components, so Svelte, React,
Vue, and plain-HTML embeds share one implementation and one look
(pixel-identical, verified). Ships as **raw `.svelte` source** via the
`svelte` export condition; your bundler compiles it against your own
Svelte version (5+). Try the viewer live at
[aspicio.frontsail.app](https://aspicio.frontsail.app/).

```bash
npm install @aspicio/svelte svelte three   # @aspicio/core and @aspicio/elements come along; svelte 5 and three (>=0.184) are peers
```

- `<AspicioEmbed>` — batteries included: layer list + interactive preview in
  one component.
- `<AspicioPreview>` — the embeddable canvas alone: pan/zoom/rotate (mouse
  and multi-touch), animated fit, batched WebGL rendering. No chrome.
  Providing `onhoverlayer` hit-tests the layer under the cursor.
- `<AspicioLayerPanel>` — the ready-made layer list, identical to the demo
  app: header with layer count, visibility checkboxes, effective-color
  swatches, entity counts, hover-to-highlight, double-click-to-solo
  (with a banner), and a gesture-hints footer. `theme="none"` renders a
  minimal list.

## One component

```svelte
<script>
  import { AspicioEmbed } from "@aspicio/svelte";
  import "@aspicio/svelte/formats/dxf";

  const onloaded = ({ layers, stats }) => console.log(stats.entityCount);
</script>

<!-- src also accepts File | Blob | ArrayBuffer | DXF text -->
<AspicioEmbed srcUrl="/drawing.dxf" style="height: 480px" {onloaded} />
```

Props: `src`, `srcUrl`, `panel` (`left` | `right` | `none`), `theme`
(`aspicio` | `none`), `panelStyle`, `options`, `showDownload`,
`shortcuts`. Callback props: `onloaded`, `onloaderror`,
`onviewerchange`, `onhoverlayer` — payloads arrive unwrapped.

## The full viewer

`bind:this` exposes `viewer()` — the complete `DrawingViewer` (`fitView`,
`zoomBy`, `setLayerVisible`, `pickLayer`, `view`, `toSVG`, `toPNG`):

```svelte
<script>
  import { AspicioEmbed } from "@aspicio/svelte";
  let embed;
</script>

<AspicioEmbed bind:this={embed} srcUrl="/drawing.dxf" />
<button onclick={() => embed.viewer()?.fitView()}>Fit</button>
```

## Custom layout

Compose `AspicioPreview` + `AspicioLayerPanel` yourself and hand the panel the
viewer from `onviewerchange`; `reverseHighlightLayer` wires canvas-hover
to the row highlight (the embed does this automatically).

## Theming

The internals render in shadow DOM. Theme through `--aspicio-*` CSS
custom properties and `::part()` hooks — see the
[`@aspicio/elements` README](../elements#theming) for the token and part
list. The theme uses IBM Plex font _stacks_ but never loads webfonts
itself; load IBM Plex Sans/Mono in your page for the exact demo look.

## Notes

- Changing `src` / `srcUrl` loads the new document; the most recently
  set source wins, and stale in-flight loads are ignored.
- `shortcuts` keys are scoped to the **focused** embed (click it first):
  `F` fit, `+`/`-` zoom, `R` reset rotation, `A` show all layers.
- Because the package is uncompiled source, there is no SSR build to
  mismatch: SvelteKit compiles it for server and client alike, and the
  viewer is only created in the browser. See `apps/svelte-example` for a
  full setup.

## Migrating from 0.x

Two breaking changes ship together:

1. **Formats are opted into by import.** Add `import "@aspicio/svelte/formats/dxf";` once —
   without it every load fails with an error saying exactly that.
2. **Format-neutral names dropped their `Dxf` prefix**: `<DxfEmbed>` / `<DxfPreview>` / `<DxfLayerPanel>` → `<AspicioEmbed>` / `<AspicioPreview>` / `<AspicioLayerPanel>`, `DxfTheme` → `AspicioTheme`, and `DxfViewer` → `DrawingViewer`.
