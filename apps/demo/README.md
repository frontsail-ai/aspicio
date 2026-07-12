# @aspicio/demo

The standalone Aspicio viewer app — and the reference integration of
[`@aspicio/core`](../../packages/core): everything in this UI is built on
the public API, no private hooks.

```bash
vp dev    # dev server (core is aliased to source — HMR across packages)
vp build  # production build (requires core built: `vp run -r build`)
vp e2e    # Playwright suite; E2E_PREVIEW=1 targets the production build
```

Features: file open/drag-drop, layer panel (toggle, hover highlight,
double-click solo), skipped-entities report, zoom/rotation readout,
canvas controls, empty/loading/error states, mobile layout. Design source:
the "Observo.dc.html" Claude Design prototype (2026-07-11).

`e2e/fixtures/` deliberately covers both DXF styling conventions —
ByLayer (`box.dxf`, `sample.dxf`) and per-entity colors
(`entity-colors.dxf`); keep both represented when adding fixtures.
