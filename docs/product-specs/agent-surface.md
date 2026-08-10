# Agent surface

Behavior of the HTTP API, the MCP server, and the plugin/skill packaging
that make drawings inspectable by AI agents.

Prefix: `AGT`.

---

### AGT-1: Structured describe

Describing a drawing returns JSON facts: the format read, unit label, bounds and size in
drawing units, entity and segment counts, per-layer entries (name, entity
count, visibility, the color actually drawn — see INV-2), per-type entity
counts, per-type skipped counts, and the drawing's text content — unique
TEXT/MTEXT strings including those inside blocks reachable through
inserts and dimensions. Identical semantics over HTTP and MCP.

**Scope.** A describe covers the whole drawing, every space of PDF-5 and
VIEW-14 included: a six-page PDF reports six pages' worth of entities, layers,
and text. A `space` argument scopes the reply to one page or sheet, and it then
reports exactly what the viewer shows on that tab. A name the drawing does not
have is refused (AGT-5), never answered with the first space.

A `spaces` list always accompanies the reply — every space by name, with its
own entity and segment counts, bounds, and size — so a caller learns a file has
six pages, and what size each is, without describing it six times. The list
does not sum to the total: a DXF sheet's viewports re-show model geometry, so
an entity can be drawn in two spaces while existing once (INV-13).

Geometry cannot be summed across spaces, so an unscoped reply's `bounds` and
`size` describe the first space — the one `render` returns — and `space` is
null to say so.

### AGT-2: Render to image

Rendering returns the drawing as an image: SVG (vector) or PNG at a
requested width (bounded, defaulting to 1200px), on a dark background by
default. It draws the first space unless a `space` argument names another, on
the same terms as AGT-1 — the pages of a multi-page PDF are reachable without
refetching the file, and an unknown name is refused rather than silently
rendered as page one. HTTP additionally accepts a hex background or "none"; anything
else is rejected, never interpolated into the SVG.

### AGT-3: HTTP input forms

`/describe` and `/render` accept the drawing either as a fetched `?src=`
URL or as the raw POST body; `/describe-pdf`, `/render-pdf`,
`/describe-doc`, and `/render-doc` take the same input forms and guards
(AGT-16). A missing source, a non-http(s) URL, or an empty body is a 400.

### AGT-4: HTTP fetch guards

`src` fetches refuse loopback/private/link-local hosts (IPv4 and IPv6),
revalidate every redirect hop (bounded hop count), cap payloads at 8 MB —
checked against the declared length before buffering — and time out (see
INV-5). The DXF endpoints are rate-limited per client IP; the health and
index endpoints stay exempt.

### AGT-5: HTTP error contract

Errors are JSON with meaningful statuses: 400 bad input, 413 too large,
422 unparseable drawing, 429 rate-limited, 502 upstream fetch failure.
Unknown routes are 404; a health endpoint reports ok. A 429 may instead
be emitted by the platform firewall in front of the API, with a
platform-standard body.

### AGT-12: The API self-describes via OpenAPI

The API serves an OpenAPI 3.1 document describing every endpoint,
parameter, schema, and error status, with authentication explicitly
declared as none — importable as-is by OpenAPI-speaking agent platforms.
The index endpoint links to it.

### AGT-6: MCP tools

A local stdio MCP server exposes the six tools of AGT-16, whose
descriptions carry the when-to-use guidance so any MCP client uses them
correctly without a bundled skill. Every tool (local and remote) declares
all three behavior hints explicitly: read-only and non-destructive (none
mutates or deletes state) and open-world (sources may be fetched from
the open web).

### AGT-7: MCP source forms

`source` accepts an http(s) URL (fetched with the same guards as AGT-4), a
local file path, or inline DXF text — resolved filesystem-first, so real
paths win over content heuristics; a path-shaped source that doesn't exist
fails with "file not found", not a parse error.

The inline form is text only, so a binary format must arrive as a URL or,
on the stdio server, a path — the hosted server has no path form at all.
Each tool's `source` description states the forms that surface actually
supports, declared once beside the tool table rather than per server. An
inline source that is recognisably a PDF fails with a message naming the
form to use instead, rather than a parse error from deep inside the file.

### AGT-8: MCP failures are protocol errors

A broken source or unparseable drawing surfaces as a clean tool error
result over the wire — never a crashed server.

### AGT-9: Render results are real images

`render_dxf` returns spec-correct MCP image content (base64 PNG with mime
type) and deliberately declares no output schema — the image is the
output. Tools whose results are data (`describe_dxf`, and on the remote
server `view_dxf` and the widget's load tool) declare output schemas and
return the same facts as validated structured content alongside the JSON
text. On the remote server, a
render of a URL source additionally names a direct HTTP link to the same
render, so chat hosts that hide MCP image blocks from the user can still
show the picture.

### AGT-13: Remote MCP endpoint

The hosted API also serves the MCP protocol over Streamable HTTP,
statelessly, at a dedicated endpoint — the same describe/render tools as
the local server, with sources limited to URLs (same guards as AGT-4) and
inline text (no file paths on a hosted server). Web clients that support
remote MCP connectors can use it with no local install. The rate limit
counts protocol messages (each initialize/list/call is one request), so a
chatty session consumes the per-IP budget faster than plain HTTP calls.

### AGT-14: In-chat viewer widget

The remote MCP endpoint offers an interactive in-chat viewer through the
MCP Apps extension: a `view_dxf` tool whose definition links a `ui://`
HTML resource carrying the bundled WebGL viewer. It opens either supported
format — DXF or vector PDF — and for a PDF shows what PDF-8 describes:
vector line work and text, not a page facsimile. The tool keeps its
DXF-era name because it is a published MCP identifier (INV-12's
external-contract exemption); the fields that carry the file across the
wire are format-neutral. On this hosted surface a PDF must arrive as a
URL — the inline form is text, which binary PDF bytes do not survive —
while the stdio server also accepts a path. The widget renders
exactly the drawing delivered by the tool call — the file travels
widget-only in the result metadata, never to the model — and offers no
way to open other files unless the tool call explicitly enabled file
controls. The widget makes no network requests, and it renders fully —
layer swatch colors included — under host security policies that refuse
inline style attributes. It follows the host's
light/dark theme and inline/fullscreen display modes; the drawing canvas
stays dark in both. Delivery adapts to host result caps: small drawings
arrive embedded in the result, larger URL-sourced drawings are pulled by
the widget itself through an app-only tool (whole-file first, byte-range
chunks as fallback), and an inline source over the embed cap degrades to
the structured summary plus an explicit too-large notice. A drawing that
parses to no drawable entities shows an explicit empty-drawing notice,
never a blank viewer. In the layer list, a long machine prefix shared by
many rows (xref-qualified names) collapses in the display; the full name
stays available on the row, and layers with no rendered geometry are
tucked into a collapsed "empty" group (omitted when there are none),
sharing the same classification as the demo. The widget
reports its terminal state — loaded, empty, or failed, with the reason —
back to
the conversation context, so the model narrates what actually happened.
Hosts without the extension ignore the UI metadata and still get a
usable text-and-facts result.

### AGT-10: One-step plugin install

The repo doubles as a plugin marketplace for both Claude Code and Codex:
one install delivers the bundled skills, and (Claude) wires the MCP server
automatically; Codex wires tools with a single documented command.

### AGT-11: Skills teach only shipped behavior

The bundled skills (inspect-dxf, embed) describe real APIs and semantics;
drift guards fail CI if a taught name stops existing in the source (see
INV-10).

### AGT-15: Discovery pages on the demo host

The demo site serves static, crawler-readable pages that describe the
agent and library surfaces: an MCP page (tools, the hosted endpoint,
local install commands, guardrails) and a docs page (packages, bindings,
install, HTTP API at a glance). Both state only shipped behavior
(INV-10), are listed in the sitemap, and are linked from the empty
screen and llms.txt.

### AGT-16: Format-specific and format-agnostic tools

Every agent surface offers three pairs: `describe_dxf`/`render_dxf` read
DXF only, `describe_pdf`/`render_pdf` read PDF only, and `describe_doc`/
`render_doc` accept any supported format and detect it from the bytes. The
typed pairs exist so an agent can state what it believes it has; the
agnostic pair exists so it doesn't have to guess. Handing a format-specific
tool the wrong format fails with a message naming the tool that would have
worked, never a parse error about the file. The HTTP API mirrors the same
six as `/describe`, `/render`, `/describe-pdf`, `/render-pdf`,
`/describe-doc`, and `/render-doc`.

Results report which format was read, so a caller never infers it from the
shape of the answer. Both MCP surfaces offer the same six format tools,
declared once so the two tables cannot drift apart. The hosted surface adds
two more — `view_dxf` and the app-only `load_dxf_for_viewer` of AGT-14 —
for eight in total; they are hosted-only because the in-chat viewer needs a
host that speaks the MCP Apps extension.
