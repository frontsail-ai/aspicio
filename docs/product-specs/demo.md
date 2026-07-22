# Demo app

Behavior specific to the standalone demo (the reference integration).

Prefix: `DEMO`.

---

### DEMO-1: Load paths

A drawing opens via the bundled sample button, a native file picker, or
drag-and-drop anywhere in the window. While loading, a status line shows
the file name; on success the top bar shows name, entity count, and
segment count.

### DEMO-2: Unsupported-entity report

When a load skips entities, a warning chip shows the total and opens a
popover listing counts per type; it is absent when nothing was skipped.

### DEMO-3: Error recovery keeps state

A failed load shows an error toast with "choose another file" and "load
sample" actions; any previously loaded drawing stays visible and usable
underneath.

### DEMO-4: Layer row interactions

Single click toggles the layer. Double click solos it (banner + SOLO chip,
other rows dimmed). In solo mode: single click exits solo showing all
layers; double click exits solo showing every layer except the clicked
one; an explicit Exit control restores all.

### DEMO-5: Deep-link view state

Pan/zoom/rotation, hidden layers, and the active space are written to the
URL hash (debounced, replacing history — no back-button spam). Opening a
link with a view hash cold auto-loads the sample and restores the exact
view, layer visibility, and space — panel state included.

### DEMO-6: Deep links encode layers compactly

Layer visibility is stored as whichever index set is smaller — hidden or
visible — so soloing one layer of a many-layer drawing yields a short,
shareable URL. A malformed or truncated hash never errors: on cold start
it opens the normal empty screen (the sample is not auto-loaded), and it
never disturbs an already-loaded drawing.

### DEMO-7: Only URL-addressable drawings are linkable

Deep links apply to the bundled sample; opening a local file clears any
stale view hash so the URL never implies it points at the new drawing.

### DEMO-8: Selection info panel

Clicking an entity opens a panel with its type, layer, color swatch, and
measurements, plus actions to isolate the layer, hide the layer, and copy
a text summary to the clipboard (with visual feedback). Clicking empty
space or Escape closes it. The panel docks in the top corner opposite the
selection — top-left when the click is in the right half of the canvas,
top-right otherwise — so it never covers the clicked point.

### DEMO-9: Measure tool UX

A toolbar toggle (or M) arms measuring: clicks add snapped points, a
rubber band follows the cursor, and a readout shows the live segment,
running total, and — once three or more points are placed — enclosed
area, each carrying the drawing unit label when the drawing has one.
Escape first clears points, then deactivates.

### DEMO-10: Shortcut cheat sheet

"?" toggles an overlay listing all keyboard shortcuts; Escape or the close
control dismisses it. The full shortcut set from VIEW-11 is wired, plus
selection actions (isolate/hide/copy).

### DEMO-11: Export menu

An Export control offers SVG (whole drawing, vector) and PNG (current
view) downloads named after the loaded file. It is hidden until a drawing
is loaded.

### DEMO-12: View chrome

The canvas shows zoom percentage (100% = fitted), rotation degrees, cursor
world coordinates, and a scale bar in round drawing units that tracks
zoom.

### DEMO-13: Mobile layout

Below tablet width the layer panel becomes a slide-in drawer with a
backdrop; the same layer interactions apply. The top toolbar always fits
the viewport — on narrow screens it wraps rather than pushing actions
(including the primary open button) off-screen.

### DEMO-14: Paper-space tabs

When the drawing has layouts, tabs above the canvas switch between Model
and each layout; the switcher is absent for model-only drawings.

### DEMO-15: Crawlable page shell

The demo page carries static, crawler-visible substance without
executing JavaScript: a descriptive title and meta description, share
metadata with a preview image, structured data describing the app, and a
static rendition of the empty screen — heading, a short description of
what Aspicio is (in-browser viewing, no upload; library, API, and MCP
surfaces), and the supported-entity list. Once the app boots it replaces
the static shell with the live empty screen; the two never disagree in
substance.

### DEMO-16: Empty-screen project links

The empty screen links to the project's home surfaces — documentation,
the MCP server page, repository, published packages, privacy policy,
and terms of use. The links are absent while a drawing is displayed
(the canvas owns the screen).
