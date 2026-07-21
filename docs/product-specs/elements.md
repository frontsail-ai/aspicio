# Web components

Behavior of the framework-neutral custom elements wrapping the viewer.
They are the single implementation behind every framework binding
(REACT-\* behaviors are delivered through them), and are directly
consumable from plain HTML, Vue, and Svelte.

Prefix: `ELEM`.

---

### ELEM-1: One-tag embed

`<aspicio-embed>` renders a complete integration — layer panel plus
interactive preview — from a single `src-url` attribute or `src` property
(text/File/Blob/ArrayBuffer), with the panel dockable left/right or
hidden via the `panel` attribute. No JavaScript beyond importing the
package is required.

### ELEM-2: Composable halves

`<aspicio-preview>` (canvas only) and `<aspicio-layer-panel>` (layer
list only) are usable on their own for custom layouts; the panel is bound
to a viewer by assigning its `viewer` property.

### ELEM-3: Source changes load the new document

Changing `src` or `src-url` loads the new drawing; responses from stale
in-flight loads are ignored, so the last-set source always wins.

### ELEM-4: The full viewer is reachable

The `viewer` property exposes the complete viewer API (camera, layers,
picking, view snapshots, exports); the `viewer-change` event reports the
instance on creation and null when the element disconnects.

### ELEM-5: Lifecycle events

`loaded` fires with layers and stats after a successful load;
`load-error` fires with the error on a failed one; with the `hover-pick`
attribute set, `hover-layer` reports the layer under the cursor or null
(the embed enables this internally to reverse-highlight panel rows).

### ELEM-6: Downloads and shortcuts match the React contract

The download control (SVG/PNG) shows by default and hides via the
`no-download` attribute; keyboard shortcuts are opt-in via the
`shortcuts` attribute and focus-scoped, so multiple embeds on one page
never collide.

### ELEM-7: Styling is encapsulated but themable

Element internals render in shadow DOM, so host-page CSS cannot
accidentally restyle them. Deliberate theming happens through
`--aspicio-*` custom properties (design tokens) and exported
`::part()` names; `theme="none"` drops the opinionated chrome and
renders minimal structure for host styling through those same hooks.

### ELEM-8: Disconnect disposes, reconnect revives

Removing an element from the document disposes its viewer (WebGL
context, observers, listeners); re-inserting it creates a fresh viewer
and reloads the current source.
