# @aspicio/mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI agents open,
inspect, and render DXF/CAD drawings and vector PDFs — built on the
[Aspicio](https://github.com/frontsail-ai/aspicio#readme) viewer's headless
pipeline. Local stdio server, no hosted dependency. A hosted endpoint and
docs live at [aspicio.frontsail.app/mcp](https://aspicio.frontsail.app/mcp/);
the interactive viewer at [aspicio.frontsail.app](https://aspicio.frontsail.app/).

## Tools

Three pairs: one per format, plus one that detects the format from the
bytes. Every `describe_*` returns structured JSON — units, bounds/size,
entity and segment counts, layers with the color actually drawn, per-type
counts, and what was skipped. Every `render_*` returns a PNG (`width`
64–4000, default 1200).

| Tool                          | Reads                           |
| ----------------------------- | ------------------------------- |
| `describe_dxf` / `render_dxf` | DXF only                        |
| `describe_pdf` / `render_pdf` | PDF only                        |
| `describe_doc` / `render_doc` | Either, detected from the bytes |

Use a `describe_*` for structural questions (layers, counts, dimensions,
units) and a `render_*` for visual ones. Handing a typed tool the wrong
format tells you which tool to use instead.

A PDF render shows vector line work and text, not a page facsimile:
images, shadings, and transparency are reported as skipped rather than
drawn. PDF measurements are in points, because a PDF carries no drawing
scale.

All six accept `source` as an **http(s) URL** or a **local file path**;
DXF may also be passed as **inline text**. A PDF is binary, so it needs a
path or a URL.

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
