# Agent surface

Behavior of the HTTP API, the MCP server, and the plugin/skill packaging
that make drawings inspectable by AI agents.

Prefix: `AGT`.

---

### AGT-1: Structured describe

Describing a drawing returns JSON facts: unit label, bounds and size in
drawing units, entity and segment counts, per-layer entries (name, entity
count, visibility, the color actually drawn — see INV-2), per-type entity
counts, per-type skipped counts, and the drawing's text content — unique
TEXT/MTEXT strings including those inside blocks reachable through
inserts and dimensions. Identical semantics over HTTP and MCP.

### AGT-2: Render to image

Rendering returns the whole drawing as an image: SVG (vector) or PNG at a
requested width (bounded, defaulting to 1200px), on a dark background by
default. HTTP additionally accepts a hex background or "none"; anything
else is rejected, never interpolated into the SVG.

### AGT-3: HTTP input forms

`/describe` and `/render` accept the DXF either as a fetched `?src=` URL
or as the raw POST body. A missing source, a non-http(s) URL, or an empty
body is a 400.

### AGT-4: HTTP fetch guards

`src` fetches refuse loopback/private/link-local hosts (IPv4 and IPv6),
revalidate every redirect hop (bounded hop count), cap payloads at 8 MB —
checked against the declared length before buffering — and time out (see
INV-5). The DXF endpoints are rate-limited per client IP; the health and
index endpoints stay exempt.

### AGT-5: HTTP error contract

Errors are JSON with meaningful statuses: 400 bad input, 413 too large,
422 unparseable DXF, 429 rate-limited, 502 upstream fetch failure.
Unknown routes are 404; a health endpoint reports ok.

### AGT-6: MCP tools

A local stdio MCP server exposes `describe_dxf` and `render_dxf`, whose
descriptions carry the when-to-use guidance so any MCP client uses them
correctly without a bundled skill.

### AGT-7: MCP source forms

`source` accepts an http(s) URL (fetched with the same guards as AGT-4), a
local file path, or inline DXF text — resolved filesystem-first, so real
paths win over content heuristics; a path-shaped source that doesn't exist
fails with "file not found", not a parse error.

### AGT-8: MCP failures are protocol errors

A broken source or unparseable drawing surfaces as a clean tool error
result over the wire — never a crashed server.

### AGT-9: Render results are real images

`render_dxf` returns spec-correct MCP image content (base64 PNG with mime
type); `describe_dxf` returns JSON text content.

### AGT-10: One-step plugin install

The repo doubles as a plugin marketplace for both Claude Code and Codex:
one install delivers the bundled skills, and (Claude) wires the MCP server
automatically; Codex wires tools with a single documented command.

### AGT-11: Skills teach only shipped behavior

The bundled skills (inspect-dxf, embed) describe real APIs and semantics;
drift guards fail CI if a taught name stops existing in the source (see
INV-10).
