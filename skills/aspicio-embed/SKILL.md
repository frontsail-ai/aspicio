---
name: aspicio-embed
description: "Use when building or modifying an app that displays DXF/CAD drawings or vector PDFs in the browser — embedding a drawing viewer in React, Vue, Svelte, plain HTML, or vanilla JS, adding layer panels, deep links, exports, or keyboard shortcuts. Covers @aspicio/elements, @aspicio/react, and @aspicio/core install, per-format entry points, props/attributes, common pitfalls (peer deps, workspace aliasing), and the headless helpers."
---

# Embedding the Aspicio drawing viewer (DXF and PDF)

## Install

```bash
npm install @aspicio/react react three   # React apps; three (>=0.184) is a peer dep
npm install @aspicio/vue vue three       # Vue 3 apps; vue 3.4+ and three are peer deps
npm install @aspicio/svelte svelte three # Svelte 5 apps; ships raw .svelte your bundler compiles
npm install @aspicio/elements three      # plain HTML (web components, no bindings)
npm install @aspicio/core three          # vanilla JS, hand-rolled UI
```

`react` 18/19 and `three` are **peer dependencies** — forgetting `three` is the most common install failure.

## Formats are opted into by import

No package implies a file format. Alongside the package import, import the
format entry once, anywhere in the app — otherwise a load fails with an error
telling you exactly this:

```ts
import "@aspicio/react/formats/dxf"; // or /vue, /svelte, /elements
import "@aspicio/react/formats/pdf"; // both, if the app opens both
import { dxfParser } from "@aspicio/core/dxf"; // vanilla: pass it to the viewer
import { pdfParser } from "@aspicio/core/pdf";
```

That indirection is what keeps a DXF app from shipping the PDF parser, and
vice versa (INV-11) — import only the formats you open.

A PDF is read as vector line work, text, and raster images: paths, strokes,
fills, glyphs, and the flattened artwork a PDF/X-4 file carries — a print
PDF whose art is one big image still shows its artwork under the dieline.
Shadings, transparency, and images in codecs outside the decoded set (JPEG
2000, JBIG2, CCITT fax) are counted as skipped rather than drawn.
Optional-content groups become layers ("Content" holds anything ungrouped),
pages become spaces, and measurements are in points, because a PDF carries
no drawing scale.

## React: one component

```tsx
import { AspicioEmbed } from "@aspicio/react";
import "@aspicio/react/formats/dxf";

<AspicioEmbed srcUrl="/drawing.dxf" style={{ height: 480 }} />;
```

Key props (all optional):

- `src` (DXF text | File | Blob | ArrayBuffer) **or** `srcUrl` (fetched) — changing either loads the new document
- `panel="left" | "right" | "none"` — the built-in layer panel
- `shortcuts` — opt-in keyboard control (F fit, +/- zoom, R rotation reset, A show-all); scoped to the **focused** embed, click to focus
- `showDownload={false}` — hide the built-in SVG/PNG export control
- `onLoaded({ layers, stats })`, `onError`, `onViewer(viewer)` — `onViewer`/`ref` expose the full `DrawingViewer` API (`fitView`, `zoomBy`, `setLayerVisible`, `pickLayer`, `view`, `setView`, `toSVG`, `toPNG`)
- `theme="none"` — drop the built-in dark theme for a minimal structure

For custom layouts compose `AspicioPreview` (canvas only) + `AspicioLayerPanel` yourself.

The components are veneers over the `@aspicio/elements` web components: internals live in shadow DOM, and theming goes through `--aspicio-*` CSS custom properties and `::part(...)` hooks (not page CSS cascade).

## Vue: the same component, Vue-flavored

```vue
<script setup>
import { AspicioEmbed } from "@aspicio/vue";
import "@aspicio/vue/formats/dxf";
</script>
<template>
  <AspicioEmbed
    src-url="/drawing.dxf"
    style="height: 480px"
    @loaded="({ stats }) => console.log(stats)"
  />
</template>
```

Same props/behavior as the React `<AspicioEmbed>`; emits `loaded`, `load-error`, `viewer-change`, `hover-layer` with unwrapped payloads; the template ref exposes `viewer` (the full `DrawingViewer`). Binding `@hover-layer` enables canvas hover-picking.

## Svelte: the same component, Svelte-flavored

```svelte
<script>
  import { AspicioEmbed } from "@aspicio/svelte";
  import "@aspicio/svelte/formats/dxf";
</script>
<AspicioEmbed srcUrl="/drawing.dxf" style="height: 480px" onloaded={({ stats }) => console.log(stats)} />
```

Same props/behavior; callback props `onloaded`, `onloaderror`, `onviewerchange`, `onhoverlayer` (providing `onhoverlayer` enables hover-picking); `bind:this` exposes `viewer()` (the full `DrawingViewer`). Ships raw `.svelte` source via the `svelte` export condition — the consumer's bundler compiles it.

## Web components: any framework or none

```html
<script type="module">
  import "@aspicio/elements";
  import "@aspicio/elements/formats/dxf";
</script>
<aspicio-embed src-url="/drawing.dxf" style="height: 480px"></aspicio-embed>
```

Same behavior as `<AspicioEmbed>`, attribute/property/event flavored: attributes `src-url`, `panel`, `theme`, `no-download`, `shortcuts`; properties `src`, `options`, `viewer` (the full `DrawingViewer`) — between `src` and `src-url` the most recently set source wins; events `loaded`, `load-error`, `viewer-change`, `hover-layer` (CustomEvents, payload in `detail`). In Vue set `compilerOptions.isCustomElement` for `aspicio-` tags; Svelte consumes them natively.

## Vanilla JS

```ts
import { DrawingViewer } from "@aspicio/core";
import { dxfParser } from "@aspicio/core/dxf";
// Pass every format the app should open; a viewer reads only what it is given.
const viewer = new DrawingViewer(container, {
  background: 0x16181d,
  parsers: [dxfParser, pdfParser],
});
await viewer.load(file); // File | Blob | ArrayBuffer | DXF text (PDF is binary)
await viewer.loadUrl("/drawing.pdf"); // for URLs — don't pass a URL to load()
```

## Headless (no browser)

`parseWith([dxfParser], bytes)` (or `parseDxf` / `parseDxfBytes` from
`@aspicio/core/dxf` directly), `tessellate`, `tessellationToSvg`, and
`describeDrawing` are pure and run in Node or Workers — parse and render SVG
server-side without a canvas. `describeDrawing(doc)` covers the whole drawing,
every page of a multi-page PDF included, and lists them in `summary.spaces`;
`describeDrawing(doc, { space })` and `tessellateSpace(doc, space)` scope a
describe or a render to one page or sheet.

## Pitfalls

- **Missing `three` peer** → install error or runtime "Cannot find module 'three'".
- **No format imported** → every load fails with "No formats imported — add
  `import "@aspicio/elements/formats/dxf"`". Import the format entry once, per
  format: importing `formats/dxf` does not make the viewer read PDF.
- **Passing a PDF as a string** → `load()` accepts DXF _text_, but a PDF is
  binary. Pass a `File`, `Blob`, or `ArrayBuffer`, or use `loadUrl()`.
- **Monorepo/workspace dev**: tsconfig `paths` fix types only; Vite needs `resolve.alias` entries mapping `@aspicio/core` → its source (list subpaths like `@aspicio/core/dxf` **first** — a string alias matches prefixes and the first match wins), or the app runs stale built `dist`.
- **Deep links**: camera state round-trips via `viewer.view` / `viewer.setView(state)`; the library never touches `location` — wire your own router (the demo's `viewurl.ts` is the reference).
- **SSR**: the viewer touches the DOM only after mount; `AspicioEmbed` is StrictMode- and SSR-safe as shipped — don't `new DrawingViewer()` during render.
