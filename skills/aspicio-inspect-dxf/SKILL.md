---
name: aspicio-inspect-dxf
description: "Use when the user shares, references, or asks questions about a DXF or PDF drawing (.dxf, .pdf) — what it contains, its layers, dimensions, size, units, or what it looks like. Requires the aspicio MCP server (describe_dxf / render_dxf, describe_pdf / render_pdf, describe_doc / render_doc). Covers choosing between structural facts and visual rendering, and interpreting the results."
---

# Inspecting DXF drawings with Aspicio

You have two Aspicio MCP tools. Pick by the kind of question:

| Question kind                                                                      | Tool                                    | Why                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| Structural: "what layers / how many parts / what size / what units / is X present" | `describe_dxf`                          | Exact JSON facts — never guess these from an image |
| Visual: "what does it look like / where is X / does it look right / show me"       | `render_dxf`                            | Returns a PNG you can actually look at             |
| Both kinds in one request                                                          | `describe_dxf` first, then `render_dxf` | Facts ground the visual read                       |
| The file is a PDF                                                                  | `describe_pdf` / `render_pdf`           | Same two questions, PDF-shaped answers             |
| You do not know the format                                                         | `describe_doc` / `render_doc`           | Detected from the bytes; the reply names it        |

Both tools accept `source` as an http(s) URL, a local file path, or inline DXF text. Prefer passing the path/URL over inlining file contents.

## Workflow

1. **Start with `describe_dxf`** unless the request is purely visual. It is cheap and grounds everything else.
2. **Interpret the summary:**
   - `units` — dimension labels ("mm", "in"); empty string means the drawing is unitless: report numbers without inventing a unit.
   - `size` / `bounds` — overall extents in drawing units. "How big is this?" = `size`, stated with `units`.
   - `layers[]` — name, entity count, and `color` (the color **actually drawn**, not the layer table's claim). CAD convention: layer names encode meaning (WALLS, DOORS, CUT, ENGRAVE…).
   - `texts` — every unique text string in the drawing (title blocks and dimension values included). Answer "what does it say / find the part number" from here directly — no render needed.
   - `entityTypes` — counts per DXF type.
   - `unsupported` — types the parser skipped. **If non-empty, say so** when completeness matters; the drawing may show less than the file contains.
3. **Render when the question is visual.** Default width is fine for an overview; bump `width` (up to 4000) when the user asks about small details. The image has a dark background — geometry is drawn in the layer colors from the summary, so you can name what you see by color.
4. **Answer from evidence.** Cite numbers from `describe_dxf`, visual observations from the render. If asked something the tools cannot establish (e.g. tolerances, materials), say the DXF does not carry it.

## Examples

**"What's in this drawing?"** → `describe_dxf`, then summarize: units, overall size, layers with counts, notable entity types, any skipped types. Offer to render it.

**"Show me the floor plan and tell me if the door swing clears the table"** → `describe_dxf` (find layer names/colors), `render_dxf` (look at the geometry: the door arc vs. the table circle, identified by their layer colors), answer with both.

**"How wide is the part?"** → `describe_dxf` → `size.width` + `units`. Do not measure pixels on a render.

## Cautions

- Never estimate dimensions from the PNG — pixels are not drawing units; use `describe_dxf`.
- Layer color in the summary is the _effective_ drawn color; trust it over assumptions about layer-table colors.
- Large drawings: describe first; render once, at a deliberate width — not repeatedly.

## PDFs

`describe_pdf` and `render_pdf` answer the same two questions for PDF
drawings, with two differences worth stating to the user rather than
discovering mid-answer:

- **Measurements are in points** (1/72 inch). A PDF carries no drawing
  scale, so "how big is this part" can only be answered in page units
  unless the drawing labels its own scale.
- **Renders show line work and text, not the page.** Images, shadings, and
  transparency are counted in the summary's skipped list rather than
  drawn, so a PDF that is mostly a scan renders nearly blank — that is an
  accurate report about the file, not a failed render. Check the skipped
  counts before concluding a drawing is empty.

Use `describe_doc` / `render_doc` when the format is unknown; the reply's
`format` field names what was read.
