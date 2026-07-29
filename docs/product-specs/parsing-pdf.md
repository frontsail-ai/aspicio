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
pipeline. Stroke width, dash pattern, and color survive — CMYK and grayscale
convert to RGB, and widths carry across as real lineweights, so a heavy line
still reads as heavy. Nested form content draws in its parent's placement.

Fills follow the path's own subpaths under one convention: the first subpath
is the outer boundary and the rest are holes, the same convention DXF fills
use. A shape with holes therefore keeps them. PDF's own two fill rules are
both approximated by that convention, which is a documented limitation rather
than a per-file decision (PDF-8).

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

### PDF-7: Unlayered content lands on one layer

PDF content carries no layer identity in this phase, so everything loads onto a
single layer named "Content". Layer panel, visibility, and color semantics
behave as they do for DXF.

### PDF-8: What this viewer does not draw is counted, never fatal

Images, shadings, soft masks, non-normal blend modes, patterned fills,
clipping paths, and glyph drawing procedures are skipped and reported per kind
(INV-3), so a describe answers honestly about what was left out.

Glyph drawing procedures are counted where embedded typefaces are not, because
they are vector artwork this pipeline could otherwise interpret — the count
records drawing that was skipped, never text that was lost, which is extracted
regardless (PDF-4). Embedded typefaces are not counted because DXF does not
count them either: both substitute the stroke font, and one policy covers both
formats.

A file made mostly of these constructs loads to a nearly empty drawing. That is
a correct report about the file, not a failure.

Two omissions can look wrong rather than incomplete, and are documented instead
of counted because they affect shapes that do draw: ignored clipping lets fills
escape a region the producer meant to crop, and the single fill convention of
PDF-3 approximates both of PDF's fill rules, so a self-intersecting or
multiply-nested path may fill differently than intended.
