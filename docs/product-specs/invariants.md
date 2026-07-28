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
`/dxf` entry points). Names that are external contracts — npm package
names, custom element tags, MCP tool names, HTTP paths — are exempt: they
are stable regardless of what they describe.
