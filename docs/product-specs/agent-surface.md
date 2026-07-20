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

### AGT-12: The API self-describes via OpenAPI

The API serves an OpenAPI 3.1 document describing every endpoint,
parameter, schema, and error status, with authentication explicitly
declared as none — importable as-is by OpenAPI-speaking agent platforms.
The index endpoint links to it.

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

### AGT-13: Remote MCP endpoint

The API Worker also serves the MCP protocol over Streamable HTTP,
statelessly, at a dedicated endpoint — the same describe/render tools as
the local server, with sources limited to URLs (same guards as AGT-4) and
inline text (no file paths on a hosted server). Web clients that support
remote MCP connectors can use it with no local install. The rate limit
counts protocol messages (each initialize/list/call is one request), so a
chatty session consumes the per-IP budget faster than plain HTTP calls.

### AGT-14: In-chat viewer widget

The remote MCP endpoint offers an interactive in-chat viewer through the
MCP Apps extension: a `view_dxf` tool whose definition links a `ui://`
HTML resource carrying the bundled WebGL viewer. The widget renders
exactly the drawing delivered by the tool call — the DXF travels
widget-only in the result metadata, never to the model — and offers no
way to open other files unless the tool call explicitly enabled file
controls. The widget makes no network requests. It follows the host's
light/dark theme and inline/fullscreen display modes; the drawing canvas
stays dark in both. Drawings over the embed cap degrade to the
structured summary plus an explicit too-large notice. Hosts without the
extension ignore the UI metadata and still get a usable text-and-facts
result.

### AGT-10: One-step plugin install

The repo doubles as a plugin marketplace for both Claude Code and Codex:
one install delivers the bundled skills, and (Claude) wires the MCP server
automatically; Codex wires tools with a single documented command.

### AGT-11: Skills teach only shipped behavior

The bundled skills (inspect-dxf, embed) describe real APIs and semantics;
drift guards fail CI if a taught name stops existing in the source (see
INV-10).
