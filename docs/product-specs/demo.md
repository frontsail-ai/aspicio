# Demo app

Behavior specific to the standalone demo (the reference integration).

Prefix: `DEMO`.

---

### DEMO-1: Load paths

A drawing opens via the bundled sample button, the Open dialog (a native
file picker or a remote URL — see DEMO-17), or drag-and-drop anywhere in
the window. The picker accepts every format the app has opted into (DXF
and PDF); drag-and-drop and URLs are format-agnostic, because what a source
is gets decided from its bytes (PARSE-13), never from its extension. While
loading, a status line shows the file name; on success the top bar shows
name, entity count, and segment count — both counts for the space on screen
(VIEW-16), redrawn when the space changes (DEMO-14).

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
one; an explicit Exit control restores all. Layers with no rendered
entities (the default `0`, `Defpoints`) are collected into a collapsible
"empty" group, collapsed by default; the group is omitted entirely when
every layer has geometry, and its rows behave like any other layer row.
When not soloing, a "Show all" control appears in the panel header as soon
as any rendered (non-empty) layer is hidden, and restores every layer;
it is absent while all rendered layers are visible and while soloing (solo
has its own Exit control).

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

Deep links apply to URL-addressable drawings — the bundled sample and any
remote URL loaded from the dialog (whose source is carried in the hash per
DEMO-18). Opening a local file clears any stale hash so the URL never
implies it points at the new drawing.

### DEMO-8: Selection info panel

Clicking an entity opens a panel with its type, layer, color swatch, and
measurements, plus actions to isolate the layer, hide the layer, and copy
a text summary to the clipboard (with visual feedback). Clicking empty
space or Escape closes it. The panel docks in the top corner opposite the
selection — top-left when the click is in the right half of the canvas,
top-right otherwise — so it never covers the clicked point. Measurements
carry the document's unit suffix (and `²` for area) when the drawing has
one, matching the measure readout and the copied summary. The path-length
row is labeled by shape: "CIRCUMFERENCE" for a circle or ellipse,
"PERIMETER" for a closed polyline, "LENGTH" otherwise.

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
and each layout; the switcher is absent for model-only drawings. Switching
redraws the header counts and the layer panel, because both describe the
space on screen (VIEW-16) — a layer's count changes with the page, and a
layer holding nothing on the new space moves into the empty-layers group.

### DEMO-15: Crawlable page shell

The demo page carries static, crawler-visible substance without
executing JavaScript: a descriptive title and meta description, share
metadata with a preview image, structured data describing the app, and a
static rendition of the empty screen — heading, a short description of
what Aspicio is (in-browser viewing, no upload; library, API, and MCP
surfaces), the formats it opens, and the supported-entity list. Once the app boots it replaces
the static shell with the live empty screen; the two never disagree in
substance.

### DEMO-16: Empty-screen project links

The empty screen links to the project's home surfaces — documentation,
the MCP server page, repository, published packages, privacy policy,
and terms of use. The links are absent while a drawing is displayed
(the canvas owns the screen).

### DEMO-17: Open dialog

The Open control (top bar and empty screen) opens one dialog that shows
both open paths at once — no tabs to switch between. A dashed dropzone opens
the native picker (and notes files are parsed locally, never uploaded);
below an "OR OPEN FROM A URL" divider, a drawing-URL field takes it from
there: the Open action stays disabled until the field holds a valid
`http(s)://` URL, and Enter submits. A submitted URL is streamed with a
live byte/percent progress bar and a Cancel control; when the server omits
`Content-Length` the bar runs indeterminate and only bytes are shown. Below
the field, the dialog remembers up to five recently loaded URLs (filename,
origin host, and size, newest first, with a Clear action) — the host
disambiguates same-named files from different origins; clicking one refills
the field without loading it.

A fetch failure shows a dedicated guidance card — honest about the cause
(a cross-origin block and an unreachable host are indistinguishable in the
browser; an HTTP status is named) — with download-and-open advice and
Try-again / Edit-URL actions; both return to the combined form. A valid
fetch that no parser claims falls back to the standard error toast
(DEMO-3, PARSE-12). The dialog anchors a fixed distance from the top so the header
stays put while the body switches between the form, progress, and error
states; on a narrow screen it spans the width and scrolls. Escape or a
backdrop click dismisses it (Cancel, not the backdrop, exits an in-flight
fetch). Pasting a drawing link (`.dxf` or `.pdf`) anywhere while the dialog is closed raises a
toast that confirms the URL before loading; pasting one while the dialog is
open drops the link straight into the URL field, ready to submit (unless the
field already has focus, where the native paste applies).

### DEMO-18: Remote URLs are deep-linkable

A drawing loaded from a remote URL is URL-addressable: its source is
written into the share hash as `src=<url>` alongside the view state, so the
link restores both the drawing and the exact view on reload. Opening such a
link auto-loads the URL on cold start (a failure opens the dialog's
guidance); a `src`-only link (no view) loads the drawing fitted. Changing
the hash live — pasting a share link into the address bar, or back/forward
between links — loads the new source without a reload (or just restores the
view when that source is already open); an empty or malformed hash never
disturbs the current drawing. The `src` value is validated as `http(s)` on
decode — a `javascript:`/`data:`/`file:` value is ignored — and only remote
URLs (never local files) are written.

### DEMO-19: Analytics consent

The demo asks once, before measuring anything. Google Analytics is loaded with
Consent Mode v2 defaults of `denied` for `ad_storage`, `ad_user_data`,
`ad_personalization` and `analytics_storage`, so no analytics cookies exist
until the visitor accepts; the denial is queued ahead of `config`, so even the
first pageview is covered. A bottom-anchored banner names Google Analytics,
says it sets cookies, restates that drawings never leave the browser, and links
to the privacy policy. Accept queues `consent update` with
`analytics_storage: granted` (ad storage stays denied — the demo runs no ads);
Decline stores the refusal and never asks again. The choice persists in
localStorage; an unrecognised or missing value re-asks rather than granting, and
a private-mode store that throws leaves the page working. The banner sits above
the paste toast but below the Open dialog and drop overlay, because it is
persistent rather than modal.

The tag itself loads only on the exact production host
(`aspicio.frontsail.app`) — never on localhost, Vercel preview aliases, or a
lookalike domain — so dev servers and the Playwright suites never report.
`?asp_consent_ui=1` renders the banner off-host for review and e2e without ever
loading the tag.

### DEMO-20: Empty-result notice

A silently empty canvas under full viewer chrome reads as a failure, so an
empty canvas explains itself. It has two causes, and they get different
answers.

The whole drawing can be undrawable — a file whose entire content is constructs
the pipeline counts instead of draws (PDF-8), or a valid file with no 2D
geometry at all. The notice then says the file parsed but has nothing to draw,
names the skipped counts when any exist, and offers the open-another-file and
sample actions. When nothing was skipped the copy says the file contains no
drawable geometry and claims nothing about skipping.

Or the space on screen can be empty while the drawing is not — an ordinary
state for a multi-page PDF. The notice then names the space on screen, names
the spaces that do hold content, and offers to go to the first of them. The
file is fine, so the open and sample actions are not what this reader needs and
are not shown. Reporting only the document-level case left this one an
unexplained blank canvas with the answer one tab away, which is the worse
failure of the two.

The notice describes the space on screen (VIEW-16) and is re-evaluated on every
space switch (DEMO-14).

The notice adds to the DEMO-2 chip rather than replacing it, and error
handling is unchanged: a _failed_ load still shows the DEMO-3 toast over
whatever was loaded before, including a previous empty result.

### DEMO-21: Transient surfaces dismiss uniformly

A transient surface — the export menu, the unsupported-entities popover, the
mobile layer drawer — closes on Escape, and closes when a modal opens, so
nothing light can sit above a modal's backdrop. Escape reaches these surfaces
first: when one is open, Escape closes it and leaves the shortcuts overlay,
measure points, and selection alone; a second Escape then continues down the
usual order (DEMO-9, DEMO-10).

The rule is deliberately about the whole class rather than each surface,
because the failure it prevents is a surface being forgotten: a menu wired
only for click-outside ignores the keyboard and outlives the overlays that
supersede it, which reads as broken rather than deliberate. Modals keep their
own documented behavior; this requirement governs what closes around them.

### DEMO-22: Theme switch

The toolbar carries a theme control that switches the whole app between
the dark and light palettes and remembers the choice across visits. It
shows the theme it switches _to_, and keeps its icon without its label on
narrow viewports, where the toolbar row is already at its width budget.

The choice is not seeded from `prefers-color-scheme`: this is a drawing
tool whose canvas has always been dark, and inheriting the OS setting
would change how a returning visitor's drawings look without them asking.

Switching repaints rather than reloads — the drawing is not re-parsed and
the camera does not move — and the layer panel is redrawn with it, because
a light canvas changes the colours actually drawn (VIEW-18) and the
swatches must keep agreeing with them (INV-2).

On a bounded space the blueprint grid stands down in favour of a plain
surround (VIEW-17): a page carries its own scale reference in its edge,
and a repeating pattern running up to that edge competes with the one line
the reader has to trust.
