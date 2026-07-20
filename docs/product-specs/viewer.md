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

Programmatic fit frames the entire visible drawing with a margin; zoom-by
factors > 1 zoom in at the viewport center; rotation reset returns to 0°
keeping center and zoom. Each is optionally animated.

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

One layer at a time can be emphasized (drawn bold on top). Highlighting a
hidden layer is treated as clearing the highlight.

### VIEW-7: Entity picking and description

A click within tolerance selects the top-most entity — edges win over
filled interiors within tolerance — and yields a structured description
(type, layer, color, length/radius/area/points/position/text as
applicable). Picking is limited to model space.

### VIEW-8: Selection overlay

The selected entity is drawn with a bright overlay (lines and fills);
selecting `null` clears it. Selection resets on load and space switch.

### VIEW-9: Object snap

Within tolerance, the cursor snaps to endpoints, points, centers, and
midpoints of visible layers only. The snap index is built lazily per
loaded space.

### VIEW-10: Measurement math

Distance accumulates over clicked points; area is reported once three or
more points are placed; values carry the drawing unit label when the
drawing has one.

### VIEW-11: Keyboard shortcuts

An attachable keyboard router drives the camera (F fit, +/- zoom, R reset
rotation) and delegates app actions (measure, show-all, isolate, hide,
copy, help, escape) to the host. It ignores modifier combos, key repeat,
and typing into form fields, and detaches cleanly.

### VIEW-12: SVG export

Exports the whole drawing (visible layers only) as a standalone vector
SVG: text as stroke paths (no font dependency), lineweights as stroke
widths, fills as filled paths, optional solid background.

### VIEW-13: PNG export is WYSIWYG

Exports the current view — same camera pose and visible layers — at native
canvas resolution, with an optional background fill behind a transparent
canvas.

### VIEW-14: Space switching

The viewer lists model space plus named paper-space layouts; switching
re-tessellates, re-fits, and renders the layout's sheet geometry with each
viewport's model content scaled and clipped to its window. Unknown names
are ignored.
