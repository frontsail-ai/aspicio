<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Aspicio — repo guide for agents

TypeScript-first 2D DXF viewer. Monorepo: `packages/core` (the library:
parse → tessellate → render pipeline, camera, gestures), `packages/react`
(bindings: DxfEmbed/DxfPreview/DxfLayerPanel), `apps/demo` (standalone
app + the Playwright e2e suite, also the reference integration).

## Commands

- `vp run ready` — check + all unit tests + all builds (the repo gate)
- `vp run e2e` — Playwright against the demo (`E2E_PREVIEW=1` = prod build)
- Releases: push a `v*.*.*` tag; see [docs/releasing.md](docs/releasing.md)

## Conventions

- **Vite+ first**: use `vp` for anything it covers (dev, build/pack, test,
  lint/format, task running); bun is only the package-manager/runtime
  backend. Exception: `bun publish` (vp has no publish; bun rewrites
  `workspace:` deps).
- Core stays framework-free and UI-opinion-free; app chrome belongs to
  the demo or the react package. New entity types are added via
  `registerEntityHandler`, not pipeline edits.
- The renderer (`render/renderer.ts`) is covered by e2e, not unit tests
  (needs real WebGL). Everything else keeps ~100% line coverage.
- e2e fixtures must cover both DXF styling conventions: ByLayer colors
  and per-entity colors (see `apps/demo/e2e/fixtures/`).
- Workspace type resolution: check/tests resolve `@aspicio/core` from
  source (tsconfig paths + vitest alias); pack steps use a paths-free
  `tsconfig.build.json` — with paths, tsgo emits stray `.d.ts` files next
  to core's sources.
