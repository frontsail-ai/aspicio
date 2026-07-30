# @aspicio/api

A serverless HTTP API (deployed on Vercel) exposing Aspicio's headless
drawing pipeline — structured facts and rendered images for agents,
scripts, and integrations. Reads DXF and the vector content of PDF. No
browser, no WebGL: parsing and SVG generation are pure JS, and PNG
rasterizes the SVG with resvg (WASM) inside the function.

## Endpoints

| Endpoint                         | Returns                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET \| POST /describe`          | JSON summary of a **DXF**: units, bounds/size, entity + segment counts, layers with the color actually drawn, per-type entity counts, skipped types                                   |
| `GET \| POST /render`            | A **DXF** as an image — `?format=png` (default) or `svg`                                                                                                                              |
| `…/describe-pdf`, `…/render-pdf` | The same two for **PDF** only                                                                                                                                                         |
| `…/describe-doc`, `…/render-doc` | The same two for **either format**, detected from the bytes                                                                                                                           |
| `GET /openapi.json`              | OpenAPI 3.1 description of this API — import it into ChatGPT Actions, Gemini/Grok function calling, or any OpenAPI-speaking tool                                                      |
| `POST /mcp`                      | Remote MCP (Streamable HTTP, stateless): the six `describe_*`/`render_*` tools plus `view_dxf` (interactive in-chat viewer) for web clients with connector support — no local install |
| `GET /health`                    | `{ "status": "ok" }`                                                                                                                                                                  |

Input is either a fetched URL (`?src=<url>`) or the file itself as the POST
body — ASCII and binary DXF alike, and PDF, all auto-detected from the
bytes. A typed endpoint handed the wrong format answers 422 naming the
endpoint that would have worked.

A PDF render shows vector line work and text, not a page facsimile:
images, shadings, and transparency are reported as skipped rather than
drawn. PDF measurements are in points, because a PDF carries no drawing
scale.

`/render` options: `width` (PNG width in px, 1–4000, default 1200) and `bg`
(background as `%23rrggbb` hex, or `none` for transparent; defaults to the
demo's dark slate).

```bash
curl "https://aspicio-api.frontsail.app/describe?src=https://example.com/plan.dxf"
curl -X POST --data-binary @plan.dxf "https://aspicio-api.frontsail.app/render?format=png&width=1600" -o plan.png
```

## Guards

- `src` must be http(s); loopback, private-range IPv4, and IPv6
  local/unique-local addresses are refused — **on every redirect hop**
  (redirects are followed manually, max 5)
- 8 MB payload cap (checked against `content-length` before buffering, and
  again after), 10 s fetch timeout
- `bg` is whitelisted to hex colors so query input can't break out of the
  SVG attribute it lands in
- The drawing endpoints and `/mcp` are rate-limited per client IP
  (60/min); `/health` and `/` stay exempt
- Errors are JSON with meaningful statuses: 400 (bad input), 413 (too
  large), 422 (unparseable drawing), 429 (rate-limited), 502 (upstream fetch
  failed)

## Development

```bash
cd apps/api
bunx vp run dev          # local server on :8788 (native resvg; build the
                         # widget first for the view_dxf viewer resource)
bunx vp test             # unit tests (rasterizer injected — the full
                         # contract suite runs the real handler in-memory)
bunx vp run build:vercel # package the deployable bundle into vercel-dist/
```

The request logic lives in `src/handler.ts`, pure except for an injected
`RenderPng` — `src/vercel.ts` wires the native resvg rasterizer and the
built widget. CI deploys the prebuilt bundle to Vercel on every master
push (`.github/workflows/deploy.yml`); production answers at
https://aspicio-api.frontsail.app.
