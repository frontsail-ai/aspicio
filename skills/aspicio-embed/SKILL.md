---
name: aspicio-embed
description: "Use when building or modifying an app that displays DXF/CAD drawings in the browser — embedding a DXF viewer in React, Vue, Svelte, plain HTML, or vanilla JS, adding layer panels, deep links, exports, or keyboard shortcuts. Covers @aspicio/elements, @aspicio/react, and @aspicio/core install, props/attributes, common pitfalls (peer deps, workspace aliasing), and the headless helpers."
---

# Embedding the Aspicio DXF viewer

## Install

```bash
npm install @aspicio/react react three   # React apps; three (>=0.184) is a peer dep
npm install @aspicio/vue vue three       # Vue 3 apps; vue 3.4+ and three are peer deps
npm install @aspicio/elements three      # plain HTML / Svelte (web components)
npm install @aspicio/core three          # vanilla JS, hand-rolled UI
```

`react` 18/19 and `three` are **peer dependencies** — forgetting `three` is the most common install failure.

## React: one component

```tsx
import { DxfEmbed } from "@aspicio/react";

<DxfEmbed srcUrl="/drawing.dxf" style={{ height: 480 }} />;
```

Key props (all optional):

- `src` (DXF text | File | Blob | ArrayBuffer) **or** `srcUrl` (fetched) — changing either loads the new document
- `panel="left" | "right" | "none"` — the built-in layer panel
- `shortcuts` — opt-in keyboard control (F fit, +/- zoom, R rotation reset, A show-all); scoped to the **focused** embed, click to focus
- `showDownload={false}` — hide the built-in SVG/PNG export control
- `onLoaded({ layers, stats })`, `onError`, `onViewer(viewer)` — `onViewer`/`ref` expose the full `DxfViewer` API (`fitView`, `zoomBy`, `setLayerVisible`, `pickLayer`, `view`, `setView`, `toSVG`, `toPNG`)
- `theme="none"` — drop the built-in dark theme for a minimal structure

For custom layouts compose `DxfPreview` (canvas only) + `DxfLayerPanel` yourself.

The components are veneers over the `@aspicio/elements` web components: internals live in shadow DOM, and theming goes through `--aspicio-*` CSS custom properties and `::part(...)` hooks (not page CSS cascade).

## Vue: the same component, Vue-flavored

```vue
<script setup>
import { DxfEmbed } from "@aspicio/vue";
</script>
<template>
  <DxfEmbed
    src-url="/drawing.dxf"
    style="height: 480px"
    @loaded="({ stats }) => console.log(stats)"
  />
</template>
```

Same props/behavior as the React `<DxfEmbed>`; emits `loaded`, `load-error`, `viewer-change`, `hover-layer` with unwrapped payloads; the template ref exposes `viewer` (the full `DxfViewer`). Binding `@hover-layer` enables canvas hover-picking.

## Web components: any framework or none

```html
<script type="module">
  import "@aspicio/elements";
</script>
<aspicio-embed src-url="/drawing.dxf" style="height: 480px"></aspicio-embed>
```

Same behavior as `<DxfEmbed>`, attribute/property/event flavored: attributes `src-url`, `panel`, `theme`, `no-download`, `shortcuts`; properties `src`, `options`, `viewer` (the full `DxfViewer`) — between `src` and `src-url` the most recently set source wins; events `loaded`, `load-error`, `viewer-change`, `hover-layer` (CustomEvents, payload in `detail`). In Vue set `compilerOptions.isCustomElement` for `aspicio-` tags; Svelte consumes them natively.

## Vanilla JS

```ts
import { DxfViewer } from "@aspicio/core";
const viewer = new DxfViewer(container, { background: 0x16181d });
await viewer.load(file); // File | Blob | ArrayBuffer | DXF text
await viewer.loadUrl("/drawing.dxf"); // for URLs — don't pass a URL to load()
```

## Headless (no browser)

`parseDxf` / `parseDxfBytes`, `tessellate`, `tessellationToSvg`, and `describeDrawing` are pure and run in Node or Workers — parse and render SVG server-side without a canvas.

## Pitfalls

- **Missing `three` peer** → install error or runtime "Cannot find module 'three'".
- **Monorepo/workspace dev**: tsconfig `paths` fix types only; Vite needs a `resolve.alias` mapping `@aspicio/core` → its source, or the app runs stale built `dist`.
- **Deep links**: camera state round-trips via `viewer.view` / `viewer.setView(state)`; the library never touches `location` — wire your own router (the demo's `viewurl.ts` is the reference).
- **SSR**: the viewer touches the DOM only after mount; `DxfEmbed` is StrictMode- and SSR-safe as shipped — don't `new DxfViewer()` during render.
