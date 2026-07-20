# Aspicio — agent guide

_Aspicio_ (Latin: "I look at") — a TypeScript-first 2D DXF viewer for the
web, with a headless pipeline that also serves AI agents: an HTTP API, an
MCP server, and installable skills/plugins. Live demo:
<https://aspicio.dmitri-66a.workers.dev>.

## Tech stack

| What               | Choice                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| Language / runtime | TypeScript; bun (package manager + runtime backend)                                 |
| Toolchain          | Vite+ (`vp`) — dev, build, test (vitest), lint/format (oxlint/oxfmt), pack (tsdown) |
| Rendering          | Three.js WebGL (viewer); resvg WASM/native for headless PNG                         |
| Parsing            | dxf-parser + custom entity handlers                                                 |
| E2E                | Playwright (`apps/demo/e2e`, `apps/react-example/e2e`)                              |
| Hosting / deploy   | Cloudflare Workers via `wrangler`, deployed from GitHub Actions                     |
| Agent protocol     | MCP (official SDK, stdio)                                                           |

## Architecture in 30 seconds

`parse → DxfDocument → tessellate → { WebGL render | SVG | describe }`.
Everything up to WebGL is headless (browser/Node/Workers). Core is
framework-free; UI opinion lives in the demo and React packages; the API
Worker and MCP server expose the same pipeline to agents. Details:
[docs/architecture.md](docs/architecture.md).

## Layout

```
packages/core     the library: parse → tessellate → render, camera, input
packages/react    <DxfEmbed> / <DxfPreview> / <DxfLayerPanel>
packages/mcp      stdio MCP server (describe_dxf, render_dxf)
apps/demo         standalone demo + main Playwright e2e suite
apps/api          Cloudflare Worker: /describe, /render
apps/react-example  real embed integration + its e2e suite
skills/           Agent Skills shared by the Claude and Codex plugins
.claude-plugin/ .codex-plugin/ .mcp.json   plugin + marketplace manifests
docs/             architecture, guidelines, product specs, releasing
```

## Commands

- `vp run ready` — check + all unit tests + all builds (**the repo gate**)
- `vp run e2e` — Playwright against the demo (`E2E_PREVIEW=1` = prod build)
- `vp run dev` — demo dev server
- Releases: push a `v*.*.*` tag — see [docs/releasing.md](docs/releasing.md)

## Documentation index

| Doc                                                                        | Summary                                                    | Load when…                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| [docs/architecture.md](docs/architecture.md)                               | Pipeline, layers, assumptions, tech choices                | changing structure, adding a surface, or unsure where code belongs |
| [docs/guidelines.md](docs/guidelines.md)                                   | Gates, planning checklist, change protocol, regression CRA | planning any change; handling a regression                         |
| [docs/product-specs/README.md](docs/product-specs/README.md)               | Spec format + index of all feature specs                   | before changing product behavior                                   |
| [docs/product-specs/invariants.md](docs/product-specs/invariants.md)       | System-wide properties (`INV-*`)                           | always worth knowing; check before architectural moves             |
| [docs/product-specs/parsing.md](docs/product-specs/parsing.md)             | `PARSE-*` — DXF input → document                           | touching parse/ or entity support                                  |
| [docs/product-specs/viewer.md](docs/product-specs/viewer.md)               | `VIEW-*` — camera, layers, picking, measure, export        | touching core viewer behavior                                      |
| [docs/product-specs/demo.md](docs/product-specs/demo.md)                   | `DEMO-*` — demo app UX incl. deep links                    | touching apps/demo                                                 |
| [docs/product-specs/react.md](docs/product-specs/react.md)                 | `REACT-*` — component behaviors                            | touching packages/react                                            |
| [docs/product-specs/agent-surface.md](docs/product-specs/agent-surface.md) | `AGT-*` — API, MCP, plugins                                | touching apps/api, packages/mcp, skills, manifests                 |
| [docs/releasing.md](docs/releasing.md)                                     | Tag-driven release runbook                                 | cutting or debugging a release                                     |
| [docs/registry-listings.md](docs/registry-listings.md)                     | MCP registry submission runbook                            | listing or updating the server in directories                      |
| [docs/README.md](docs/README.md)                                           | How docs/ itself is managed                                | adding or restructuring docs                                       |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                         | Contributor mechanics: commands, testing, CI, releasing    | onboarding a human contributor                                     |

## Conventions & process (the short version)

- **Vite+ first**: use `vp` for anything it covers; bun only as the
  package-manager/runtime backend. Exception: `bun publish` (vp has no
  publish; bun rewrites `workspace:` deps).
- Core stays framework-free and UI-opinion-free (INV-1); new entity types
  go through `registerEntityHandler` (INV-6).
- The renderer is e2e-tested; all other new logic ships with unit tests
  (INV-7); e2e fixtures cover both ByLayer and per-entity colors (INV-8).
- Workspace type resolution: checks/tests resolve `@aspicio/core` from
  source (tsconfig `paths` **and** the vite alias — new workspaces need
  both); pack/deploy steps use the built dist.
- Specs lead. Cite spec IDs (`VIEW-3`, `INV-2`) in plans, tests, and PRs;
  surface conflicts instead of silently editing either side. Full rules:
  [docs/guidelines.md](docs/guidelines.md).
- On regressions: root-cause first (5-whys), report before fixing.

_`CLAUDE.md` is a symlink to this file — Claude Code and Codex read the
same guide._

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
