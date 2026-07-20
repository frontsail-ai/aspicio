# Parsing & document model

Behavior of turning DXF input into the normalized drawing document.

Prefix: `PARSE`.

---

### PARSE-1: Accepted input forms

A drawing loads from DXF text, a `File`/`Blob`, or an `ArrayBuffer`; bytes
are decoded as UTF-8.

### PARSE-2: Binary DXF is rejected loudly

Input starting with the "AutoCAD Binary DXF" sentinel is refused with an
error telling the user to export as ASCII DXF — it is never fed to the text
parser to fail confusingly.

### PARSE-3: Supported entity types

LINE, LWPOLYLINE/POLYLINE (including bulge arcs), CIRCLE, ARC, ELLIPSE,
SPLINE, TEXT, MTEXT, DIMENSION, SOLID, TRACE, 3DFACE, solid HATCH
(pattern HATCH falls back to its boundary outline), POINT, and nested
INSERT all produce geometry.

### PARSE-4: Unsupported types are counted per type

Any other entity type is skipped and its count reported per type name
(see INV-3); the rest of the drawing is unaffected.

### PARSE-5: Drawing units

The document carries a short unit label (e.g. "mm", "in") derived from the
drawing's units header, or an empty string when the drawing is unitless or
the code is unknown.

### PARSE-6: Layer table and entity color coexist

Every layer records its table color, and entities may override color
individually; both survive into the document so effective color can be
computed (see INV-2). Entities referencing a layer missing from the table
get an auto-created layer entry.

### PARSE-7: Block inserts resolve CAD conventions

Nested INSERTs apply their transforms recursively; block entities on layer
"0" adopt the insert's layer; ByBlock color inherits from the insert.

### PARSE-8: Paper-space layouts are separated

Entities flagged as paper space form named layouts with their viewports;
model space stays distinct. Layout viewports record the model-view window
needed to render scaled, clipped model content.

### PARSE-9: Text is normalized to plain content

MTEXT formatting codes are collapsed to plain text; TEXT/MTEXT keep
position, height, and rotation for rendering with the built-in stroke font.

### PARSE-10: Linetypes and lineweights are resolved

Dash patterns resolve entity → layer → continuous; lineweights resolve
entity → block override → layer → hairline. Text is never dashed.
