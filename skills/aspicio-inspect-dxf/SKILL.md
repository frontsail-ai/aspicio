---
name: aspicio-inspect-dxf
description: "Use when the user shares, references, or asks questions about a DXF file or CAD drawing (.dxf) — what it contains, its layers, dimensions, size, units, or what it looks like. Requires the aspicio MCP server (describe_dxf / render_dxf tools). Covers choosing between structural facts and visual rendering, and interpreting the results."
---

# Inspecting DXF drawings with Aspicio

You have two Aspicio MCP tools. Pick by the kind of question:

| Question kind                                                                      | Tool                                    | Why                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| Structural: "what layers / how many parts / what size / what units / is X present" | `describe_dxf`                          | Exact JSON facts — never guess these from an image |
| Visual: "what does it look like / where is X / does it look right / show me"       | `render_dxf`                            | Returns a PNG you can actually look at             |
| Both kinds in one request                                                          | `describe_dxf` first, then `render_dxf` | Facts ground the visual read                       |

Both tools accept `source` as an http(s) URL, a local file path, or inline DXF text. Prefer passing the path/URL over inlining file contents.

## Workflow

1. **Start with `describe_dxf`** unless the request is purely visual. It is cheap and grounds everything else.
2. **Interpret the summary:**
   - `units` — dimension labels ("mm", "in"); empty string means the drawing is unitless: report numbers without inventing a unit.
   - `size` / `bounds` — overall extents in drawing units. "How big is this?" = `size`, stated with `units`.
   - `layers[]` — name, entity count, and `color` (the color **actually drawn**, not the layer table's claim). CAD convention: layer names encode meaning (WALLS, DOORS, CUT, ENGRAVE…).
   - `entityTypes` — counts per DXF type. TEXT/MTEXT presence means there are annotations worth reading off a render.
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
