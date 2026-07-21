# Getting listed in MCP registries

Where agents and people discover MCP servers, and how Aspicio gets into
each. The metadata lives in the repo (`server.json`, `smithery.yaml`,
`glama.json`); the submissions themselves need the repo owner's
accounts — this is the runbook.

**Prerequisites (all already true after the reach-plan stack merges):**
`@aspicio/mcp` published to npm; the remote endpoint live at
`https://aspicio-api.dmitri-66a.workers.dev/mcp`; `server.json`,
`smithery.yaml`, and `glama.json` on `master`.

The supported set is deliberately these four — the canonical registry
plus the three community directories with real curation or install
tooling. mcp.so was considered and skipped (scrape-heavy, low signal).

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
2025-12-11 (that revision renamed the package fields to camelCase and
capped `description` at 100 chars — both bit us once already).

## 2. Smithery (smithery.ai)

Sign in with GitHub → Add server → point it at this repo. It reads
`smithery.yaml` (stdio launch via `npx -y @aspicio/mcp`).

## 3. Glama (glama.ai)

Crawls npm + GitHub, so listing generally appears on its own once the
package is public. `glama.json` at the repo root names the GitHub
users allowed to claim and maintain the listing (that is the file's
entire schema — display metadata comes from the crawl). If the entry
hasn't appeared after a few days, use "Add MCP Server" on the site.

## 4. PulseMCP (pulsemcp.com)

Hand-curated; auto-ingests the official registry weekly, so listing #1
gets this for free. If the entry hasn't appeared a week after the
official listing, use the site's Submit form.

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
