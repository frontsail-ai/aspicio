# @aspicio/api

A Cloudflare Worker exposing Aspicio's headless DXF pipeline over HTTP —
structured facts and rendered images for agents, scripts, and integrations.
No browser, no WebGL: parsing and SVG generation are pure JS, and PNG
rasterizes the SVG with resvg (WASM) inside the Worker.

## Endpoints

| Endpoint                | Returns                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET \| POST /describe` | JSON summary: units, bounds/size, entity + segment counts, layers with the color actually drawn, per-type entity counts, skipped types        |
| `GET \| POST /render`   | The drawing as an image — `?format=png` (default) or `svg`                                                                                    |
| `GET /openapi.json`     | OpenAPI 3.1 description of this API — import it into ChatGPT Actions, Gemini/Grok function calling, or any OpenAPI-speaking tool              |
| `POST /mcp`             | Remote MCP (Streamable HTTP, stateless): the same `describe_dxf`/`render_dxf` tools for web clients with connector support — no local install |
| `GET /health`           | `{ "status": "ok" }`                                                                                                                          |

Input is either a fetched URL (`?src=<dxf-url>`) or the DXF file itself as
the POST body — ASCII and binary DXF alike (auto-detected).

`/render` options: `width` (PNG width in px, 1–4000, default 1200) and `bg`
(background as `%23rrggbb` hex, or `none` for transparent; defaults to the
demo's dark slate).

```bash
curl "https://<worker>/describe?src=https://example.com/plan.dxf"
curl -X POST --data-binary @plan.dxf "https://<worker>/render?format=png&width=1600" -o plan.png
```

## Guards

- `src` must be http(s); loopback, private-range IPv4, and IPv6
  local/unique-local addresses are refused — **on every redirect hop**
  (redirects are followed manually, max 5)
- 8 MB payload cap (checked against `content-length` before buffering, and
  again after), 10 s fetch timeout
- `bg` is whitelisted to hex colors so query input can't break out of the
  SVG attribute it lands in
- The DXF endpoints are rate-limited per client IP (60/min); `/health`
  and `/` stay exempt
- Errors are JSON with meaningful statuses: 400 (bad input), 413 (too
  large), 422 (unparseable DXF), 429 (rate-limited), 502 (upstream fetch
  failed)

## Development

```bash
cd apps/api
bunx wrangler dev      # run locally (workerd)
bunx vp test           # unit tests (rasterizer injected, no WASM needed)
bunx wrangler deploy   # manual deploy (CI does this on master)
```

The request logic lives in `src/handler.ts`, pure except for an injected
`RenderPng` — `src/index.ts` wires the resvg-wasm rasterizer.
