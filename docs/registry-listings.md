# Getting listed in MCP registries

Where agents and people discover MCP servers, and how Aspicio gets into
each. The metadata lives in the repo (`server.json`, `smithery.yaml`);
the submissions themselves need the repo owner's accounts — this is the
runbook.

**Prerequisites (all already true after the reach-plan stack merges):**
`@aspicio/mcp` published to npm; the remote endpoint live at
`https://aspicio-api.dmitri-66a.workers.dev/mcp`; `server.json` and
`smithery.yaml` on `master`.

## 1. Official MCP registry (registry.modelcontextprotocol.io)

The canonical index; several other directories crawl it, so this one
multiplies.

```bash
brew install mcp-publisher          # or download from the registry repo
mcp-publisher login github          # proves ownership of frontsail-ai
mcp-publisher publish               # reads ./server.json
```

Notes: the `io.github.frontsail-ai/*` namespace is granted by the GitHub
login. Re-run `publish` after each release — the `server.json` version
bump is a step in [releasing.md](releasing.md). Before the first real
submission, run `mcp-publisher publish --dry-run`: the tool validates
against the current schema and is the ground truth if it has moved past
2025-07-09.

## 2. Smithery (smithery.ai)

Sign in with GitHub → Add server → point it at this repo. It reads
`smithery.yaml` (stdio launch via `npx -y @aspicio/mcp`).

## 3. mcp.so

Community directory. Submit via the "Submit" form on the site (name,
repo URL, description) — or the maintainers accept PRs to their data
repo. Two-minute job.

## 4. PulseMCP + Glama

Both primarily **crawl** — PulseMCP ingests the official registry, and
Glama indexes npm + GitHub. Listing #1 and having the npm package public
generally gets these for free; each site has a "claim/submit" flow if the
entry hasn't appeared after a few days.

## What to say (shared blurb)

> **Aspicio** — open, inspect, and render DXF/CAD drawings. `describe_dxf`
> returns structured JSON (layers with the colors actually drawn, units,
> bounds, entity counts, and the drawing's text content — title blocks
> and dimension values included); `render_dxf` returns a PNG the model
> can look at. Sources: URL, local file path (stdio server), or inline
> DXF. ASCII and binary DXF. Remote endpoint available for web clients
> with connector support.

## Keeping listings honest

`server.json` versions are pinned; bump them at release time alongside
the packages (INV-9, INV-10). If a listing's description drifts from
shipped behavior, fix the listing — the spec IDs (`AGT-*`) are the source
of truth.
