# docs/

How this directory is organized and maintained. Project content lives in
the files; this page is about managing them.

## What lives here

| File                                         | Holds                                                            |
| -------------------------------------------- | ---------------------------------------------------------------- |
| [architecture.md](architecture.md)           | Layers, boundaries, technical assumptions, tech choices          |
| [guidelines.md](guidelines.md)               | Process: gates, planning checklist, change protocol, regressions |
| [releasing.md](releasing.md)                 | The tag-driven release runbook                                   |
| [registry-listings.md](registry-listings.md) | Runbook for MCP registry/directory submissions                   |
| [product-specs/](product-specs/README.md)    | Behavioral specs (one file per feature area) + invariants        |
| `*.png`                                      | Screenshots referenced by READMEs                                |

## Spec format (summary — full rules in [product-specs/README.md](product-specs/README.md))

- Behavioral, not implementation. Self-evidently testable bodies.
- `### PREFIX-NUM: Title` IDs; unique within a file; **never renumbered**
  — deletions leave holes. Cite IDs in tests, PRs, and commits.
- Invariants (`INV-*`) are system-wide properties, kept separately.

## Process rules

- Treat docs as code: changes ship in the same PR as the behavior they
  describe, and go through review.
- Specs lead. If implementation disagrees with a spec, surface the
  conflict — don't silently rewrite the spec.
- Every spec/architecture change is confirmed with the user.
- Reference spec IDs (`VIEW-3`, `INV-2`, …) instead of restating behavior.

## When to update what

| Change                              | Update                                        |
| ----------------------------------- | --------------------------------------------- |
| New/changed product behavior        | The feature spec file (+ index if a new file) |
| New system-wide property            | `product-specs/invariants.md`                 |
| New layer, boundary, or tech choice | `architecture.md`                             |
| New process rule                    | `guidelines.md`                               |
| New doc file                        | This README's table + `AGENTS.md`'s index     |

## When NOT to write a doc

Implementation details (they live in code and its comments), one-off
decisions already captured in a PR description, or anything without
observable behavior (build tweaks → architecture only if they change an
assumption).

## Naming

Lowercase kebab-case, `.md`; feature specs named after the feature area
(`viewer.md`, not `spec-viewer-v2-final.md`).
