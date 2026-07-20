# @aspicio/mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI agents open,
inspect, and render DXF/CAD drawings — built on the
[Aspicio](https://github.com/frontsail-ai/aspicio#readme) viewer's headless
pipeline. Local stdio server, no hosted dependency.

## Tools

| Tool           | Returns                                                                                                                                   | Use for                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `describe_dxf` | Structured JSON: units, bounds/size, entity + segment counts, layers with the color actually drawn, per-type entity counts, skipped types | Structural questions — layers, counts, dimensions, units |
| `render_dxf`   | A PNG image (`width` 64–4000, default 1200)                                                                                               | Visual questions — what the drawing looks like           |

Both accept `source` as an **http(s) URL**, a **local file path**, or
**inline DXF text**.

## Install

Claude Code / Claude Desktop:

```bash
claude mcp add aspicio -- npx -y @aspicio/mcp
```

Codex:

```bash
codex mcp add aspicio -- npx -y @aspicio/mcp
```

Any other MCP client: register the stdio command `npx -y @aspicio/mcp`.

Prefer a one-step install with bundled skills? The
[aspicio plugin](https://github.com/frontsail-ai/aspicio#for-agents) wires
this server plus usage skills into Claude Code and Codex.

## Safety

URL sources are fetched with a private-host guard (loopback, RFC1918,
IPv6 local ranges — revalidated on every redirect hop) and an 8 MB cap, so
a model acting on untrusted input can't turn the server into a
LAN/localhost probe.

## Notes

- PNG rendering uses `@resvg/resvg-js` (native prebuilds; Node ≥ 18).
- Unsupported entity types are counted and reported in the summary, never
  fatal — see the core README for the full support matrix.
