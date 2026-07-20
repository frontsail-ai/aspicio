# React bindings

Behavior of the React components wrapping the viewer.

Prefix: `REACT`.

---

### REACT-1: One-component embed

`<DxfEmbed>` renders a complete integration — layer panel plus interactive
preview — from a single `src` (text/File/Blob/ArrayBuffer) or `srcUrl`
prop, with the panel dockable left/right or hidden.

### REACT-2: Source changes load the new document

Changing `src` or `srcUrl` loads the new drawing; responses from stale
in-flight loads are ignored, so the last-set source always wins.

### REACT-3: The full viewer is reachable

`ref` and `onViewer` expose the complete viewer API (camera, layers,
picking, view snapshots, exports); camera state is deliberately not React
state — hosts subscribe to viewer events to display it.

### REACT-4: Lifecycle callbacks

`onLoaded` fires with layers and stats after a successful load; `onError`
fires with the error on a failed one; `onHoverLayer` reports the layer
under the cursor or null.

### REACT-5: Built-in download control

A download control offering SVG/PNG export shows by default and can be
hidden with `showDownload={false}`; the export methods stay callable
either way.

### REACT-6: Keyboard shortcuts are opt-in and focus-scoped

`shortcuts` (default off) enables keyboard camera control plus show-all on
the focused embed only; clicking the embed focuses it, so multiple embeds
on one page never collide.

### REACT-7: Theming

The demo look (dark panel, blueprint grid) ships by default;
`theme="none"` inherits host styles instead. Webfonts are never loaded by
the library.

### REACT-8: SSR and StrictMode safe

The viewer is created only after mount and disposed on unmount; double
effect invocation under StrictMode leaks nothing.

### REACT-9: Layer panel parity

`<DxfLayerPanel>` reproduces the demo's layer semantics — visibility
checkboxes, effective-color swatches (see INV-2), entity counts,
hover-to-highlight, double-click solo with banner.
