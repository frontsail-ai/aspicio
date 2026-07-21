# Vue bindings

Behavior of the Vue 3 components wrapping the viewer. Like the React
bindings, they are thin veneers over the web components (see
[elements.md](elements.md)) and must stay functionally and visually
identical to them and to the React components.

Prefix: `VUE`.

---

### VUE-1: One-component embed

`<DxfEmbed>` renders a complete integration — layer panel plus
interactive preview — from a single `src` (text/File/Blob/ArrayBuffer)
or `src-url` prop, with the panel dockable left/right or hidden.

### VUE-2: Source changes load the new document

Changing `src` or `src-url` loads the new drawing; the most recently set
source wins, and responses from stale in-flight loads are ignored.

### VUE-3: The full viewer is reachable

The template ref exposes `viewer` — the complete viewer API (camera,
layers, picking, view snapshots, exports); `@viewer-change` reports the
instance on creation and null on unmount. Reactive wrappers never reach
the viewer: values held in `ref()`/`reactive()` state are unwrapped
before use.

### VUE-4: Lifecycle emits

`@loaded` fires with layers and stats after a successful load;
`@load-error` fires with the error on a failed one; `@hover-layer`
reports the layer under the cursor or null — and binding it enables
canvas hover-picking.

### VUE-5: Built-in download control

A download control offering SVG/PNG export shows by default and can be
hidden with `:show-download="false"`; the export methods stay callable
via the exposed viewer either way.

### VUE-6: Keyboard shortcuts are opt-in and focus-scoped

`shortcuts` (default off) enables keyboard camera control plus show-all
on the focused embed only; clicking the embed focuses it, so multiple
embeds on one page never collide.

### VUE-7: Theming

The demo look ships by default; `theme="none"` drops it for a minimal
structure. Theming goes through the elements' `--aspicio-*` custom
properties and `::part()` hooks (ELEM-7), plus `panelStyle` for inline
panel styles. Webfonts are never loaded by the library.

### VUE-8: SSR safe

Importing the package is safe in Node (Nuxt SSR); the viewer is created
only after client-side mount and disposed on unmount.
