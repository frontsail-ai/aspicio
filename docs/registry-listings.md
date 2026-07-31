# Getting listed in MCP registries

Where agents and people discover MCP servers, and how Aspicio gets into
each. The metadata lives in the repo (`server.json`, `smithery.yaml`,
`glama.json`); the submissions themselves need the repo owner's
accounts — this is the runbook.

**Prerequisites (all already true after the reach-plan stack merges):**
`@aspicio/mcp` published to npm; the remote endpoint live at
`https://aspicio-api.frontsail.app/mcp`; `server.json`,
`smithery.yaml`, and `glama.json` on `master`.

The supported set is deliberately these four — the canonical registry
plus the three community directories with real curation or install
tooling. mcp.so was considered and skipped (scrape-heavy, low signal).

## 1. Official MCP registry (registry.modelcontextprotocol.io)

The canonical index; several other directories crawl it, so this one
multiplies.

**Automated:** every release publishes the listing from the tag-driven
workflow via GitHub OIDC — the workflow's identity in this repo grants
`io.github.frontsail-ai/*`, no tokens involved. It stamps `server.json`
with the release version before submitting (the in-repo pre-tag bump
stays a [releasing.md](releasing.md) step because the deployed server
reads `server.json` for its `serverInfo`).

Manual runs (out-of-band metadata changes only):

```bash
brew install mcp-publisher          # or download from the registry repo
MCP_GITHUB_TOKEN=$(gh auth token) mcp-publisher login github
mcp-publisher publish               # reads ./server.json
```

Notes: org namespaces are granted only to org **Owners**, checked via
`GET /user/memberships/orgs` — the interactive device-flow login cannot
see org membership (its private GitHub App is uninstallable), so pass a
personal token with `read:org` as above; the error message's hint about
public membership is a red herring. The npm package must embed
`mcpName` matching the server name (drift-guarded in the mcp tests). Before the first real
submission, run `mcp-publisher publish --dry-run`: the tool validates
against the current schema and is the ground truth if it has moved past
2025-12-11 (that revision renamed the package fields to camelCase and
capped `description` at 100 chars — both bit us once already).

### ChatGPT app directory (when submitting)

Submission assets live in-repo: directory icon
`apps/demo/public/icon-256.png` (form wants ≥256×256), composer icon
`apps/demo/public/icon-48.png` (≥48×48), legacy `icon-64.png`, privacy
`https://aspicio.frontsail.app/privacy/`, terms `…/terms/`,
support contact `support@frontsail.ai`. All tools carry explicit
readOnly/openWorld/destructive hints (drift-guarded) — the form blocks
on any missing hint. `chatgpt-app-submission.json` at the repo root is
the import file the form's Info step accepts (generated per the
`$chatgpt-app-submission` skill contract from
`openai/openai-developers-for-claude`); regenerate it if tools, hints,
or app copy change.

## 2. Smithery (smithery.ai)

Sign in with GitHub → Add server → point it at this repo. It reads
`smithery.yaml` (stdio launch via `npx -y @aspicio/mcp`).

Smithery computes a **quality score** from the server metadata: `description`
and `homepage` in `smithery.yaml` are worth 24 of the 35 "Server Metadata"
points, so keep them present (the registry test pins them to `server.json`'s
`description`/`websiteUrl`). `render_dxf` intentionally has no `outputSchema`
(it returns an image), so "Output schemas" caps at 3/4 — expected, not a gap.

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

> **Aspicio** — open, inspect, and render DXF/CAD drawings and vector
> PDFs. Three describe/render pairs: `describe_dxf`/`render_dxf` for DXF,
> `describe_pdf`/`render_pdf` for PDF, and `describe_doc`/`render_doc`
> when the format isn't known (detected from the bytes). A `describe`
> returns structured JSON (the format read, layers with the colors
> actually drawn, units, bounds, entity counts, and the drawing's text
> content — title blocks and dimension values included); a `render`
> returns a PNG the model can look at. Built for PDF/X-4 artwork and
> dielines: a PDF is read as vector line work and text rather than a page
> facsimile, so images, shadings, and transparency are reported as
> skipped, and measurements are in points because a PDF carries no
> drawing scale. Sources: URL, local file path (stdio server), or inline
> DXF text — a PDF is binary, so it needs a URL or a path. ASCII and
> binary DXF alike. Remote endpoint available for web clients with
> connector support, including an interactive in-chat viewer that opens
> either format.

## Keeping listings honest

`server.json` versions are pinned; bump them at release time alongside
the packages (INV-9, INV-10). If a listing's description drifts from
shipped behavior, fix the listing — the spec IDs (`AGT-*`) are the source
of truth.
