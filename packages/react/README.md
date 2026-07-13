# @aspicio/react

React bindings for the
[Aspicio](https://github.com/frontsail-ai/aspicio#readme) DXF viewer.

```bash
npm install @aspicio/react react three   # @aspicio/core comes along; react 18/19 and three (>=0.184) are peers
```

- `<DxfEmbed>` — batteries included: layer list + interactive preview in one
  component.
- `<DxfPreview>` — the embeddable canvas alone: pan/zoom/rotate (mouse and
  multi-touch), animated fit, batched WebGL rendering. No chrome. Pass
  `onHoverLayer` to hit-test the layer under the cursor.
- `<DxfLayerPanel>` — the ready-made layer list, identical to the demo app:
  header with layer count, visibility checkboxes, effective-color swatches,
  entity counts, hover-to-highlight, double-click-to-solo (with a banner),
  and a gesture-hints footer. `theme="none"` renders a minimal unstyled list.

## One component

```tsx
import { DxfEmbed } from "@aspicio/react";

// file: File | Blob | ArrayBuffer | string (DXF text) — or use srcUrl
<DxfEmbed src={file} style={{ height: 480 }} />;
```

Props: `panel="left" | "right" | "none"`, `panelStyle`, `options`,
`onLoaded`, `onError`, plus a `ref` exposing the full `DxfViewer`.

### Theming

`DxfEmbed` and `DxfLayerPanel` ship with the Aspicio demo look by default —
dark panel, blueprint grid behind a transparent canvas, hover states. Pass
`theme="none"` to inherit the host page's styles instead.

The theme uses IBM Plex font _stacks_ but never loads webfonts itself (no
surprise network requests from a library). Load IBM Plex Sans/Mono in your
page for the exact demo typography; otherwise system faces are used. The
raw tokens are exported as `aspicioTokens` if you want to match the palette
elsewhere.

## Custom layout

```tsx
import { useRef, useState } from "react";
import type { DxfViewer } from "@aspicio/core";
import { DxfLayerPanel, DxfPreview } from "@aspicio/react";

export function DrawingPage({ url }: { url: string }) {
  const viewerRef = useRef<DxfViewer>(null);
  const [viewer, setViewer] = useState<DxfViewer | null>(null);

  return (
    <div style={{ display: "flex", height: 480 }}>
      <DxfLayerPanel viewer={viewer} style={{ width: 220 }} />
      <DxfPreview
        ref={viewerRef}
        srcUrl={url}
        options={{ background: 0x16181d }}
        onViewer={setViewer}
        onLoaded={({ stats }) => console.log(stats)}
        onError={(error) => console.error(error)}
      />
    </div>
  );
}
```

Notes:

- The viewer instance (via `ref` or `onViewer`) is the full `@aspicio/core`
  API — `fitView`, `zoomBy`, `resetRotation`, `setLayerVisible`,
  `setLayerHighlight`, `pickLayer`, `view`, `stats`.
- `src` accepts DXF text, `File`, `Blob`, or `ArrayBuffer`; `srcUrl` fetches.
  Changing either loads the new document; stale in-flight loads are ignored.
- A built-in **Download** control (SVG / PNG export) shows by default; pass
  `showDownload={false}` to hide it. The viewer's `toSVG()` / `toPNG()` stay
  callable via the ref regardless.
- `shortcuts` (default off) enables keyboard control on the **focused** embed:
  `F` fit, `+`/`-` zoom, `R` reset rotation, `A` show all layers. Click the
  embed to focus it — keys are scoped to the focused container so multiple
  embeds on a page don't collide. See `apps/react-example` for a full setup.
- Camera state is deliberately not React state — subscribe to the `render`
  event on the viewer if you need to display it.
- StrictMode and SSR safe: the viewer is created in an effect and disposed on
  unmount.
