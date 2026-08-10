# Invariants

Conditions that hold across the whole system. Unlike feature specs, they are
not testable in isolation — they are upheld by code review, architectural
boundaries, and process together. IDs are stable: never renumber.

---

### INV-1: Core is framework- and UI-opinion-free

`@aspicio/core` never depends on a UI framework, never touches `location`,
history, or app chrome. App-level behavior (routing, panels, toasts) belongs
to the demo or the React package.

### INV-2: The UI never contradicts the canvas

Anything that displays a layer color shows the color actually drawn
(entity overrides included), not the layer table's claim. Summaries,
panels, and agent tools all derive color from the same tessellation truth.

### INV-3: Unsupported input is counted, never fatal

Unknown entity types are skipped and reported per type; a drawing with
unsupported content still parses, renders, and describes. Structurally
invalid input fails with a clear, human-readable error.

### INV-4: Rendering is on-demand only

Nothing repaints on a free-running loop. A frame is drawn only in response
to a state change (camera, visibility, selection, resize, load), coalesced
per animation frame.

### INV-5: Every URL-fetching agent surface carries the same guard

Any surface that fetches a caller-supplied URL (HTTP API, MCP) refuses
loopback/private/link-local hosts — revalidated on every redirect hop — and
enforces a payload size cap and timeout.

### INV-6: New entity types extend via the handler registry

Entity support is added through the registration seam, not by editing the
tessellation pipeline.

### INV-7: The renderer is verified end-to-end, everything else at unit level

The WebGL renderer is covered by browser e2e tests (it needs a real GL
context). All other new logic ships with unit tests in the same change;
no enforced coverage threshold exists today (core sits near 80% lines),
so "tested" is a review obligation, not a gate.

### INV-8: Test fixtures cover both DXF styling conventions

Rendering fixtures include both ByLayer-colored and per-entity-colored
drawings, so neither convention regresses silently.

### INV-9: Public packages version together

`@aspicio/core`, `@aspicio/elements`, `@aspicio/react`, `@aspicio/vue`,
`@aspicio/svelte`, and `@aspicio/mcp` are stamped with the same version at release, and
inter-package ranges never leak the workspace protocol into published
tarballs.

### INV-10: Agent-facing docs never overclaim

READMEs, skills, and tool descriptions state only shipped behavior; drift
guards tie taught API names to the source that defines them.

### INV-11: Format parsers live behind their own entry point

A format's parser is reachable only through a dedicated entry point
(`@aspicio/core/dxf`, `@aspicio/elements/formats/dxf`, and the matching
subpath on each framework binding). The root entries of `@aspicio/core`
and the binding packages contain no parser and imply no format, so a
consumer of one format never ships another format's code. Separation is
guaranteed by module boundaries, never by bundler tree-shaking, and is
proven by a bundle-composition gate that runs inside the repo gate for
every published frontend package.

### INV-12: A name carries "Dxf" iff the thing is DXF-specific

Format-neutral types read `Drawing*` (`DrawingDocument`, `DrawingParser`,
`DrawingParseError`); product-level components and themes read `Aspicio*`;
only DXF-specific API keeps `Dxf` (`parseDxf`, `binaryDxfToText`, the
`/dxf` entry points).

Exemptions exist for one reason: renaming would break something already
installed that shipping new code cannot fix. Three layers follow from it.

**The settled list**, where no judgement is needed: npm package names,
custom element tags, MCP tool names, and HTTP paths. `view_dxf` and
`load_dxf_for_viewer` serve both formats and keep their names on this
basis (AGT-14). Custom element tags show why the list has to exist at
all — they live in consumers' HTML, so nothing we ship records them and
no search of ours can find them.

**The test for anything else**, falsifiable rather than argued: a name is
exempt only if it appears in one of the registry manifests we publish —
`server.json`, `smithery.yaml`, `chatgpt-app-submission.json`. Not "a
file we publish": npm ships `README.md` in every tarball and the READMEs
document everything, so that phrasing exempts every name in the project.
A name in none of the manifests follows the rule however outward-facing
it looks.

OpenAPI `operationId`s are the worked example. A platform turns each into
a callable function, which reads as external by any plain reading — but
they appear in no manifest and reach importers only through a document
re-fetched on every import, so they were renamed (`describeDxfPdf` →
`describePdf`) while `view_dxf` was not.

### INV-13: A count names its scope, and its parts sum to it

Every entity count belongs to exactly one scope — one space, or the whole
drawing — and any breakdown of it sums to it: a space's layer counts sum to
that space's total, and a drawing's layer counts sum to the drawing's.

Scope is carried by the artifact, not by convention. Per-space counts ride on
the tessellation, which _is_ one space, so a count cannot be read beside
geometry from a different one. Producers derive counts from one shared
function rather than accumulating their own.

This exists because three producers each chose a scope independently — the DXF
parser counted model space plus the active sheet, the PDF parser counted every
page, the viewer counted model space alone — and a layer reported more
entities than the drawing contained. Every single-space drawing agreed, so the
divergence was invisible until a six-page PDF showed a layer holding 6020
entities in a drawing of 996.
