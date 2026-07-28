# Parsing & document model

Behavior of turning drawing input into the normalized document. DXF's own
rules are below; how a format gets chosen is PARSE-13.

Prefix: `PARSE`.

---

### PARSE-1: Accepted input forms

A drawing loads from text, a `File`/`Blob`, an `ArrayBuffer`, or raw bytes;
every form normalizes to bytes before a format is chosen (PARSE-13). DXF
text is decoded as UTF-8.

### PARSE-2: Binary DXF is decoded

Input starting with the "AutoCAD Binary DXF" sentinel is decoded — both the
R12 1-byte and R13+ 2-byte group-code variants — and parses to the same
document as its ASCII twin. Truncated binary input ends the stream cleanly
instead of erroring mid-record.

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
Legacy control sequences decode to plain content in both: `%%d`/`%%p`/`%%c`
become ° / ± / Ø (case-insensitive, with stroke-font glyphs), the
`%%u`/`%%o`/`%%k` style toggles are dropped, `%%%` is a literal percent,
`%%nnn` is character nnn, `\U+XXXX` escapes are decoded, and unknown `%%`
sequences stay literal.

### PARSE-10: Linetypes and lineweights are resolved

Dash patterns resolve entity → layer → continuous; lineweights resolve
entity → block override → layer → hairline. Text is never dashed.

### PARSE-11: Out-of-range boolean header flags are tolerated

Real-world files carry non-0/1 values at boolean group codes 290–299
(e.g. `$XCLIPFRAME 2`, a 0/1/2 enum since DXF 2010). Such values are
coerced to 0/1 instead of failing the whole parse.

### PARSE-12: Invalid input yields a clean, honest error

Input that no parser claims fails with a `DrawingParseError` phrased for a
person: "The file is empty" for empty or whitespace-only input, "Not a
supported drawing file" otherwise. Input a parser does claim but cannot
read reports that format's own message — "Not a valid DXF file" — with
`format` set. The underlying parser's internal messages ("Empty file",
which fires for any single-line non-empty file; "Unexpected end of input
…") never reach a user surface.

### PARSE-13: Formats are parsed through a registry of injected parsers

A parser declares its format name, a byte sniff, and a parse function; the
viewer and the headless surfaces take a list of parsers and try their
sniffs in the order given, parsing with the first match. Input is
normalized to bytes first (PARSE-1), so sniffing sees the same bytes on
every input form.

Nothing is registered implicitly: a viewer configured with no parsers
fails a load with an error naming the fix (VIEW-15), and a source no
parser claims fails per PARSE-12. Every parse failure is a
`DrawingParseError`, whose optional `format` field names the parser that
rejected the file when one claimed it — so callers report the culprit
without matching on message text.
