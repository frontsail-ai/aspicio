# Viewer

Behavior of the embeddable viewer: camera, layers, selection, measurement,
export. Applies to any host (demo, React, custom).

Prefix: `VIEW`.

---

### VIEW-1: Camera gestures

Drag pans; wheel/pinch zooms anchored at the cursor; Shift+drag or
two-finger twist rotates; double click/tap fits the whole drawing with an
animated ease. User gestures cancel any running camera animation.

### VIEW-2: Fit, zoom, and rotation controls

Programmatic fit frames the entire drawing's extents with a margin
(hidden layers included — bounds come from the loaded geometry, not
visibility); zoom-by
factors > 1 zoom in at the viewport center; rotation reset returns to 0°
keeping center and zoom. Each is optionally animated.

For a **bounded** space the page itself is part of those extents
(VIEW-17), so a fit frames the paper rather than the ink on it — matching
Acrobat and Preview, and keeping a drawing whose artwork sits in one
corner of the page from opening zoomed into that corner. Unbounded spaces
are unaffected.

### VIEW-3: View state round-trips

The camera pose (center, units-per-pixel, rotation) can be read as a
snapshot and later restored exactly — the basis for shareable deep links.
Restoring rejects a non-positive zoom. A snapshot is only meaningful for
the same document.

### VIEW-4: Layer visibility is instant and non-destructive

Hiding a layer removes it from the canvas (and from hit-testing/snapping)
without re-tessellating; showing it back restores identical geometry.

### VIEW-5: Effective layer colors

Each layer exposes the colors actually drawn on it, dominant first, for any
UI to display (see INV-2); the layer-table color is only a fallback for
layers with nothing drawn.

### VIEW-6: Layer highlight

One layer at a time can be emphasized (drawn bold on top of all content —
raster images included). Highlighting a hidden layer is treated as clearing
the highlight.

### VIEW-7: Entity picking and description

A click selects the entity with the nearest edge within tolerance, else
one whose filled interior contains the point (no z-ordering is implied),
and yields a structured description
(type, layer, color, length/radius/area/points/position/text as
applicable). Picking is limited to model space.

### VIEW-8: Selection overlay

The selected entity is drawn with a bright overlay (lines and fills) above
all content, raster images included; selecting `null` clears it. Selection
resets on load and space switch.

The overlay's colour is supplied by the host per theme, because no single
value works everywhere: the dark-canvas blue is 10:1 there, 1.8:1 on paper
and 1.25:1 on a light canvas. The renderer picks between the pair by
whether the space has paper; the host picks the pair by theme.

### VIEW-9: Object snap

Within tolerance, the cursor snaps to endpoints, points, centers, and
midpoints of visible layers only. The snap index is built lazily per
loaded space.

<!-- VIEW-10 removed pre-merge: measurement accumulation is host behavior,
not a core viewer feature — see DEMO-9. The number stays retired. -->

### VIEW-11: Keyboard shortcuts

An attachable keyboard router drives the camera (F fit, +/- zoom, R reset
rotation) and delegates app actions (measure, show-all, isolate, hide,
copy, help, escape) to the host. It ignores modifier combos, key repeat,
and typing into form fields, and detaches cleanly.

### VIEW-12: SVG export

Exports the whole drawing (visible layers only) as a standalone vector
SVG: text as stroke paths (no font dependency), lineweights as stroke
widths, fills as filled paths, optional solid background. The viewBox
pads the drawing slightly so edge strokes are not clipped, and an empty
or degenerate drawing still yields a nonzero-size SVG that rasterizers
accept.

### VIEW-13: PNG export is WYSIWYG

Exports the current view — same camera pose and visible layers — at native
canvas resolution, with an optional background fill behind a transparent
canvas.

### VIEW-14: Space switching

The viewer lists model space plus named paper-space layouts; switching
re-tessellates, re-fits, and renders the layout's sheet geometry with each
viewport's model content scaled and clipped to its window. Unknown names
are ignored.

### VIEW-16: Readouts describe the space on screen

Entity and segment counts report the active space, not the document: switching
spaces (VIEW-14) changes both, and a layer's entity count changes with them. A
sheet counts the model-space layers its viewports draw, once however many
windows show them, so no layer reads zero while its geometry is on screen
(INV-2). Layer _rows_ stay document-wide — every layer the drawing declares is
listed in every space — so a layer with nothing on the current space is listed
with a count of zero and collapses under the shared `isEmptyLayer` rule.

The whole-drawing total remains available for the one question that needs it:
whether anything loaded at all (DEMO-20).

### VIEW-15: Loading requires a configured parser

The viewer parses nothing by itself: `parsers` in `DrawingViewerOptions`
decides which formats it accepts (PARSE-13). A viewer created without
parsers loads nothing and says so, naming the import that fixes it
("no format parsers configured — pass `parsers: [dxfParser]` from
`@aspicio/core/dxf`").

### VIEW-17: Bounded spaces are drawn on paper

A space that declares a page box — today, a PDF page — renders that page
as an opaque sheet beneath everything else, with the area outside it left
to the host to style. The sheet's colour is a viewer option defaulting to
white, and it is white rather than a warmed "paper" tint because in a PDF
the sheet is the _unpainted_ region: artwork that paints 0/0/0/0 white
would otherwise show as a visible rectangle against the paper it is meant
to match. Substrate simulation belongs to a soft-proof mode with a stated
white point, not to the default backdrop.

The sheet is not a layer. It is never pickable, never snappable, never
hidden by layer visibility, and never appears in the layer panel.

An unbounded space — every DXF space, and any PDF page whose boxes will
not read — renders exactly as it did before this existed.

Because paper changes what a selection is drawn over, the selection
overlay uses a second colour on a bounded space: the canvas variant is
1.8:1 against white and would be illegible there (VIEW-8).

### VIEW-18: Pen colours stay legible on a light canvas

When the host supplies the canvas colour it is judging against, DXF
entity colours are darkened — hue preserved, chroma refit to gamut —
until they reach 3.5:1 contrast against it. The default is off, and
nothing changes for a host that does not ask.

This applies to DXF only. A DXF colour is a _display attribute_: an ACI
index names a pen, and the RGB it resolves to is a convention for showing
that pen on a black screen. PDF colour is ink, and a dieline authored in
100% cyan renders as 100% cyan on the sheet in every theme.

The rule targets contrast, not lightness. Perceptual lightness and WCAG
relative luminance do not track across hues, so no fixed lightness
threshold can guarantee a ratio.

Darkening is one-directional and only helps against a light background,
so when the target cannot be reached the colour is left as it reads best
rather than walked towards the background.

A pen with no hue is a separate case. Its identity is entirely its
lightness, and the default DXF pen — ACI 7, the commonest colour in real
drawings — arrives as white because the palette assumes a black screen.
Stopping such a pen at the contrast target leaves it a washed-out
mid-grey where every CAD tool draws near-black. So the achromatic ramp is
reflected into the range between the theme's ink and the lightest legible
grey: white lands on ink, and the ramp stays distinct and ordered rather
than collapsing to one value. Prominence survives the flip — the lightest
pen on a dark screen becomes the darkest on a light one.

Layer summaries and swatches report the colours actually drawn, so this
transform is visible in them too (INV-2).

### VIEW-19: Pages carry their production guides

A page that declares a TrimBox or a BleedBox distinct from its sheet
draws them as dashed rectangles above the artwork they measure and below
any overlay. They are one screen pixel at every zoom — a guide that
thickened under magnification would compete with the line work it exists
to qualify — and their colours do not vary with theme, because they are
always drawn on white paper.
