# Product specs

Behavioral specifications for Aspicio, one file per feature area.

## Format rules

1. **Behavioral.** Specs say _what_ the system does, never _how_ — no
   function, class, or file names (public API/prop/endpoint names are
   fine: they are the product surface).
2. **Self-evidently testable.** Each body is precise enough to derive a
   verification path directly. If it isn't, rewrite the body — never bolt
   on a "testable" annotation.
3. **Identified.** `### PREFIX-NUM: Short title`. The prefix is shared by
   all specs in a file; numbers are unique within the file and **never
   reused or renumbered** — deletions leave holes. IDs are stable
   references for tests, PRs, and code comments.

**Invariants** ([invariants.md](invariants.md), prefix `INV`) are
different: system-wide properties upheld by review, boundaries, and
process — not necessarily testable in isolation.

## Index

| File                                 | Prefix  | Covers                                                                                             |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------------- |
| [invariants.md](invariants.md)       | `INV`   | System-wide properties                                                                             |
| [parsing.md](parsing.md)             | `PARSE` | DXF input → normalized document: entity coverage, binary rejection, units, colors, blocks, layouts |
| [viewer.md](viewer.md)               | `VIEW`  | Camera, layers, picking, snap/measure, shortcuts, view snapshots, exports, spaces                  |
| [demo.md](demo.md)                   | `DEMO`  | Demo app: load paths, deep links, panels, error recovery, mobile                                   |
| [react.md](react.md)                 | `REACT` | React components: embed, lifecycle, theming, SSR safety                                            |
| [agent-surface.md](agent-surface.md) | `AGT`   | HTTP API, MCP tools, plugin/skill packaging                                                        |
