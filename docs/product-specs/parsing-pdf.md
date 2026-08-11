# PDF parsing

Behavior of turning PDF input into the same normalized drawing document DXF
produces. Which parser runs is PARSE-13; this file is what the PDF parser does
once it claims a file.

Prefix: `PDF`.

---

### PDF-1: What a PDF must be to load at all

A PDF is claimed by its `%PDF-` header and then read strictly. Three
conditions refuse the file outright, each with a message phrased for a person
(PARSE-12), because loading anyway would silently misrepresent the drawing:

- **Encryption.** An encrypted PDF reports "Encrypted PDFs are not
  supported". A digital signature is not encryption: a signed but unencrypted
  file loads normally.
- **Text whose glyphs are absent from the file.** Text drawn in a font the
  file does not carry reports "This PDF needs fonts it doesn't embed". Glyphs
  supplied as drawing procedures count as present (PDF-4), so a font whose
  glyphs are procedures rather than an embedded program is accepted.
- **Content in another file.** Content stored outside this document reports
  "This PDF's content lives in another file", rather than loading a drawing
  that is silently missing part of itself.

Anything else that merely exceeds what this viewer draws is counted, never
fatal (PDF-8).

### PDF-2: Real-world file structure is read, not just the simple case

Cross-reference tables, cross-reference streams, object streams, and
incremental-update chains all resolve, including files that mix them. A later
update's definition of an object wins over an earlier one. Flate-compressed
streams decompress, including the byte predictors those streams use, and a
stream whose length is stored indirectly is followed. A file whose
cross-reference data is unusable is still read by finding its objects
directly, rather than refused.

A page's content may be one stream or an ordered series of them; the series is
read as a single stream, and a construct never spans the join. Pages inherit
resources and page geometry from their ancestors.

### PDF-3: Vector content becomes drawing geometry

Painted paths become geometry: strokes become polylines, fills become filled
regions, and curves flatten at the same resolution as the rest of the
pipeline. Stroke width, dash pattern, and color survive — widths carry across
as real lineweights, so a heavy line still reads as heavy. Nested form content
draws in its parent's placement.

Color follows the file's color spaces. Device gray, RGB, and CMYK convert to
RGB directly; an ICCBased space reads as the device space its component count
names, the alternate the PDF specification itself prescribes for a viewer
without color management. A Separation — a spot ink, such as a dieline's
/Cutting — and a single-colorant DeviceN evaluate their tint transform into
the alternate space, so spot-colored content keeps its intended color rather
than reading a full tint as "gray 1", which is white. A tint transform this
viewer cannot evaluate colors by ink coverage instead — full ink is dark,
never white — and is counted; a space it cannot convert leaves the current
color standing and is counted (PDF-8).

Fills follow the path's own subpaths under one convention: the first subpath
is the outer boundary and the rest are holes, the same convention DXF fills
use. A shape with holes therefore keeps them. PDF's own two fill rules are
both approximated by that convention, which is a documented limitation rather
than a per-file decision (PDF-8).

Clipping paths crop what follows them. A path that reads as a convex region —
a rectangle, the parallelogram a transformed rectangle becomes, any convex
outline — narrows the region in force, and nested clips intersect it further,
so a shape draws only where every enclosing region allows and clips that fail
to overlap leave nothing drawable at all. Strokes are cut at the boundary, and
a stroke a region interrupts becomes several runs rather than one bridging the
gap; fills keep their holes; a placed image keeps the pixels inside the region
and no others (PDF-9). A form XObject's `/BBox` narrows the region the same
way, because the specification crops a form to it, and the region a form is
invoked under carries into its content. A path that is _not_ a convex region —
a concave outline, one built from curves, several subpaths at once — leaves
the region it found in place and is counted instead (PDF-8): the drawing is
then no worse than before clipping was applied at all.

Text is deliberately exempt from cutting. Glyph widths are estimated rather
than read (PDF-4), so a run is dropped only where it provably cannot reach the
region — at twice its estimated length — and one overlapping the boundary
draws whole rather than half. Losing a word a reader can see would be a worse
failure than drawing one past the crop.

### PDF-4: Text becomes text, not outlines

Text-showing operators produce text entities positioned, sized, and rotated by
the text and transformation matrices. Characters decode through the file's own
character maps where present, and through the font's declared encoding
otherwise, so the extracted text matches what a reader sees.

Glyphs render with the built-in stroke font, as DXF text does (PARSE-9): the
words are readable, searchable, and describable, but they are not tracings of
the file's typeface. This applies to every font — including fonts whose glyphs
are drawing procedures, whose text is extracted the same way even though those
procedures are not drawn (PDF-8).

### PDF-5: Pages are spaces

Page 1 loads as model space; each later page becomes a named space ("Page 2",
"Page 3", …) reachable through the same space switcher as paper-space layouts
(VIEW-14, PARSE-8). Every page of a multi-page PDF is viewable without
reloading.

### PDF-6: PDFs measure in points

A PDF document reports "pt" as its unit, and every measurement derives from
PDF user space unchanged — no axis flip, no invented scale. A drawing whose
real-world scale lives only in its artwork is not second-guessed.

### PDF-7: Optional-content groups become layers

Content marked with an optional-content group loads onto a layer named for that
group — through marked content (`/OC … BDC … EMC`) or through an `/OC` entry on
a form or image XObject; both occur in real files. Layer identity is
document-wide: a group referenced from several pages is one layer across the
spaces of PDF-5, not one per page.

A layer's _count_, unlike its identity, is scoped to one space (VIEW-16,
INV-13): the row for a group carrying content on four pages reports what the
page on screen holds, and changes as pages change. A row whose count spans the
document while the total beside it spans one page are not two views of one
number, and disagreed by thousands on real files.

Content belonging to no group stays on a layer named "Content", which remains
for that purpose rather than disappearing — real files range from fully layered
to fully unlayered. It is listed when it holds something, or when nothing else
does, so a fully-layered file shows only the groups the file declares and a
drawing always has at least one layer. Layer panel and visibility semantics behave as they do for
DXF: a group declared in the file but referenced by no content becomes a layer
with no entities, which the shared `isEmptyLayer` rule collapses in every
panel. That is correct reporting of what the file declares, not a stray row.

Layer order follows the default configuration's `/Order`, then any remaining
groups in the order `/OCGs` declares them. `/Order` is routinely partial — a
real file carries 35 groups and orders 3 — so it selects sequence, never
membership: no group is dropped for being unordered.

Default visibility is read from whichever list the base state makes meaningful:
with the default base state of on, the `/OFF` list hides; with a base state of
off, everything is hidden except the `/ON` list. Reading only `/OFF` would
render a mostly-hidden document fully visible, silently. Where a group declares
usage auto-states that would differ between screen and print, the screen state
wins — Aspicio is a viewer — and the divergence is counted (PDF-8).

Two groups may declare the same name, and real files do. A document's layers
are keyed by name, so the second and later groups sharing one are suffixed —
"One (2)" — rather than merged: every group the file declares keeps its own row
and its own toggle. Merging would hide content the reader never asked to hide,
which is the failure INV-2 guards against on the colour side. Nothing is
counted, because nothing is omitted; only a display name differs from the
file's.

A membership dictionary naming exactly one group resolves to that group. One
naming several is a set rather than a layer: the first is used and the
simplification counted (PDF-8). One carrying a visibility expression is not
evaluated; its content stays on "Content" and the expression is counted.

A PDF has no layer table, so a layer's `color` carries a neutral placeholder
rather than a claim. The colors actually drawn populate `effectiveColors` from
tessellation, which is the field INV-2 tells every surface to prefer; a layer
that drew nothing has none.

### PDF-8: What this viewer does not draw is counted, never fatal

Shadings, soft masks (the graphics-state kind — an image's own soft mask
draws, PDF-9), non-normal blend modes, patterned fills, and glyph drawing
procedures are skipped and reported per kind (INV-3), so a describe answers
honestly about what was left out. An image outside PDF-9's
decodable set — JPEG 2000, JBIG2, CCITT fax, a progressive JPEG, an exotic
colour space — is counted as `Image`, the same key as before images drew, so
a count consumer needs no migration. Three optional-content cases are
counted the same way (PDF-7): a membership dictionary simplified to its
first group, a visibility expression left unevaluated, and a group whose
print visibility differs from the screen state that was used.

Glyph drawing procedures are counted where embedded typefaces are not, because
they are vector artwork this pipeline could otherwise interpret — the count
records drawing that was skipped, never text that was lost, which is extracted
regardless (PDF-4). Embedded typefaces are not counted because DXF does not
count them either: both substitute the stroke font, and one policy covers both
formats.

A clipping path is counted only where it could not be applied (PDF-3): a
concave outline, one built from curves, several subpaths at once, or a
placement whose region needs a per-pixel mask larger than this viewer will
build. The count therefore names a region that was ignored, not every region
in the file — across the acceptance corpus it falls from 3,134 to 82. A file
whose count is zero was cropped exactly as its producer asked.

Two color simplifications are counted the same way, because they change a
color rather than omit a shape: a tint transform this viewer cannot evaluate
falls back to ink coverage, and a color space it cannot convert — Indexed,
Lab, a multi-colorant DeviceN, or a name that resolves to nothing — leaves
the current color in place (PDF-3). The count is what keeps a changed color
from passing as a faithful one.

A file made mostly of these constructs loads to a nearly empty drawing. That is
a correct report about the file, not a failure.

Two approximations can look wrong rather than incomplete, and are documented
instead of counted because they affect shapes that do draw. The single fill
convention of PDF-3 approximates both of PDF's fill rules, so a
self-intersecting or multiply-nested path may fill differently than intended.
And a clipped image crops on whole pixels of its own raster, so a placement
may keep up to one source pixel past its region — the alternative, rounding
inward, would shave a column the region genuinely covers.

### PDF-9: Raster images draw

Image XObjects decode to pixels and draw as image entities, placed by the
transformation matrix like every other construct and landing on the layer
their context dictates — a marked-content group or the XObject's own `/OC`
(PDF-7). One object referenced from many pages or many operators decodes
once; every placement shares the pixels. Inline images (`BI … EI`) remain
counted.

What decodes: Flate samples at 1, 2, 4, 8, and 16 bits per component (16
keeps the high byte), and baseline JPEG through an own decoder — including
the Adobe conventions real prepress files use, where four-component data is
stored inverted. Pixels colour through the same resolved spaces as vector
colour (PDF-3) — one resolver for pixels and paths, evaluated tint
transforms and counted fallbacks included — plus Indexed through its base
space, which is layered onto the image side because palettes occur in
images while vector colour counts them. A colour simplification in an image
counts once per decode, never per pixel. `/Decode` arrays remap; an image's
`/SMask` becomes its alpha; a stencil mask paints the current fill colour.
Anything else — JPEG 2000, JBIG2, CCITT fax, progressive JPEG — is counted
(PDF-8).

Decoded pixels are capped at 2048 on the long side, box-filtered down: a
viewer never needs a 300-dpi press raster at full resolution, and the cap
bounds memory and export payloads. The cap is a quality floor to revisit,
not a contract.

Draw order is approximated in layers rather than stream order: images under
fills, fills under strokes — the existing fills-under-lines approximation
extended one level. For the files this exists for, that ordering is the
correct one: artwork below, dieline above, always. A file relying on paint
order between an image and a fill may differ from a reference viewer, the
same documented trade the fill convention makes (PDF-3).

### PDF-10: Pages carry their geometry

Every page reports the box it is drawn on, so the viewer can put paper
under it (VIEW-17) and frame it (VIEW-2).

The sheet is the **CropBox intersected with the MediaBox** — the box
Acrobat and Preview display. A file imposed on oversized media declares
its finished page in the CropBox, and using the media would draw paper no
reader ever sees. The intersection rather than a straight preference is
deliberate: the spec requires the CropBox to lie within the media, and
real files violate it.

TrimBox and BleedBox are read for the same page and default to the
CropBox. They are **not** inherited: PDF makes only `/Resources`,
`/MediaBox`, `/CropBox` and `/Rotate` inheritable, so a TrimBox found on
an ancestor node is not this page's box. A guide equal to the sheet is
dropped, since a line on the paper's edge states nothing.

All boxes pass through the page's own `/Rotate` transform, so a rotated
page's paper lands where its ink does.

A page whose boxes will not read loses its backdrop, not its content —
it renders as an unbounded space.
