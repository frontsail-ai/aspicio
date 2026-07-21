# Svelte bindings

Behavior of the Svelte 5 components wrapping the viewer. Like the React
and Vue bindings, they are thin veneers over the web components (see
[elements.md](elements.md)) and must stay functionally and visually
identical to them.

Prefix: `SVELTE`.

---

### SVELTE-1: One-component embed

`<DxfEmbed>` renders a complete integration — layer panel plus
interactive preview — from a single `src` (text/File/Blob/ArrayBuffer)
or `srcUrl` prop, with the panel dockable left/right or hidden.

### SVELTE-2: Source changes load the new document

Changing `src` or `srcUrl` loads the new drawing; the most recently set
source wins, and responses from stale in-flight loads are ignored.

### SVELTE-3: The full viewer is reachable

`bind:this` exposes `viewer()` — the complete viewer API (camera,
layers, picking, view snapshots, exports); `onviewerchange` reports the
instance on creation and null on unmount.

### SVELTE-4: Lifecycle callbacks

`onloaded` fires with layers and stats after a successful load;
`onloaderror` fires with the error on a failed one; `onhoverlayer`
reports the layer under the cursor or null — and providing it enables
canvas hover-picking.

### SVELTE-5: Built-in download control

A download control offering SVG/PNG export shows by default and can be
hidden with `showDownload={false}`; the export methods stay callable via
the exposed viewer either way.

### SVELTE-6: Keyboard shortcuts are opt-in and focus-scoped

`shortcuts` (default off) enables keyboard camera control plus show-all
on the focused embed only; clicking the embed focuses it, so multiple
embeds on one page never collide.

### SVELTE-7: Theming

The demo look ships by default; `theme="none"` drops it for a minimal
structure. Theming goes through the elements' `--aspicio-*` custom
properties and `::part()` hooks (ELEM-7), plus `panelStyle` for inline
panel styles. Webfonts are never loaded by the library.

### SVELTE-8: Ships as source

The package publishes raw `.svelte` components via the `svelte` export
condition; the consumer's bundler compiles them, so behavior always
matches the consumer's own Svelte version (5+).
