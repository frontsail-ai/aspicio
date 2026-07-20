# Engineering guidelines

Process rules for changing this repo. Product behavior lives in
[product-specs/](product-specs/); architecture in
[architecture.md](architecture.md).

## Quality gates

- **Lint/format/type-check 100%** — `vp check` must pass; never disable a
  rule or skip a test to get green.
- **Test 100% of new logic** — ~100% line coverage everywhere except the
  WebGL renderer, which is covered by the Playwright e2e suite instead
  (INV-7).
- **The repo gate** is `vp run ready` (check + all unit tests + all
  builds); browser coverage is `vp run e2e`. Run both before pushing
  non-trivial changes.
- **CI-truth check:** `vp check` must also pass with `packages/core/dist`
  absent — a stale local dist has masked broken tsconfig `paths` more than
  once.

## Planning checklist (mandatory for every plan)

1. Validate assumptions — read the source on HEAD, run cheap experiments;
   don't trust memory.
2. Cross-validate against product specs — name every affected spec ID and
   the plan step satisfying it.
3. Cross-validate against [architecture.md](architecture.md) — boundaries
   (INV-1, INV-6) and assumptions.
4. Plan automated test coverage for the new logic (per policy above).
5. Plan end-to-end verification — and actually perform it in a real
   browser/runtime before calling the work done.

## Change protocol

- **Product behavior change** → consult the specs first. Specs lead: if
  the implementation diverged, surface the conflict — never silently edit
  a spec to match code.
- **Architecture change** → consult architecture.md; deviations are
  discussed, not snuck in.
- **Any conflict** (spec vs. code, plan vs. invariant) → bring it up for
  discussion before proceeding.
- **Docs updates ship with the change** — README/spec edits belong in the
  same PR as the behavior they describe (INV-10), but every spec change is
  confirmed with the user.

## Regressions

On any regression, run a root-cause analysis (5-whys) and report the root
cause **before** attempting a fix. Fix the cause, add the missing test,
and check for siblings of the same defect.

## Submitting

Feature branches (`korya-<type>-<slug>`), Conventional Commit subjects,
draft PRs with `## Problem` / `## Solution` bodies, CI watched to green —
the full mechanics live in the team's submit workflow. Releases are
tag-driven; see [releasing.md](releasing.md).
