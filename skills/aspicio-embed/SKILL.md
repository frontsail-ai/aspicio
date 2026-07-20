---
name: aspicio-embed
description: "Use when building or modifying an app that displays DXF/CAD drawings in the browser — embedding a DXF viewer in React or vanilla JS, adding layer panels, deep links, exports, or keyboard shortcuts. Covers @aspicio/react and @aspicio/core install, props, common pitfalls (peer deps, workspace aliasing), and the headless helpers."
---

# Embedding the Aspicio DXF viewer

## Install

```bash
npm install @aspicio/react react three   # React apps; three (>=0.184) is a peer dep
npm install @aspicio/core three          # vanilla JS / other frameworks
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
- `theme="none"` — inherit host styles instead of the built-in dark theme

For custom layouts compose `DxfPreview` (canvas only) + `DxfLayerPanel` yourself.

## Vanilla JS

```ts
import { DxfViewer } from "@aspicio/core";
const viewer = new DxfViewer(container, { background: 0x16181d });
await viewer.load(file); // File | Blob | ArrayBuffer | DXF text
```

## Headless (no browser)

`parseDxf` / `parseDxfBytes`, `tessellate`, `tessellationToSvg`, and `describeDrawing` are pure and run in Node or Workers — parse and render SVG server-side without a canvas.

## Pitfalls

- **Missing `three` peer** → install error or runtime "Cannot find module 'three'".
- **Monorepo/workspace dev**: tsconfig `paths` fix types only; Vite needs a `resolve.alias` mapping `@aspicio/core` → its source, or the app runs stale built `dist`.
- **Deep links**: camera state round-trips via `viewer.view` / `viewer.setView(state)`; the library never touches `location` — wire your own router (the demo's `viewurl.ts` is the reference).
- **SSR**: the viewer touches the DOM only after mount; `DxfEmbed` is StrictMode- and SSR-safe as shipped — don't `new DxfViewer()` during render.
