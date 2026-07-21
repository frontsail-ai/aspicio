import { describeDrawing, parseDxfBytes, tessellate, tessellationToSvg } from "@aspicio/core";
import { fetchDxf, HttpError, MAX_BYTES } from "./fetch.ts";
import { handleMcp } from "./mcp.ts";
import { openapi } from "./openapi.ts";

const DEFAULT_BG = "#16181d";
const DEFAULT_WIDTH = 1200;
const MAX_WIDTH = 4000;

/** Rasterize an SVG string to PNG bytes. Injected so the runtime-specific
 * (WASM) rasterizer stays out of the testable request logic. */
export type RenderPng = (svg: string, width: number) => Promise<Uint8Array>;

/** Per-caller rate check: true = allowed. Injected (the binding is runtime). */
export type CheckRateLimit = (key: string) => Promise<boolean>;

/** Endpoints that do real work (fetch/parse/rasterize) and get rate-limited. */
const WORK_ENDPOINTS = new Set(["/describe", "/render", "/mcp"]);

const CORS = { "access-control-allow-origin": "*" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

/** Resolve the DXF bytes from a GET `?src=` URL or a POST request body. */
async function resolveDxf(req: Request, url: URL): Promise<Uint8Array> {
  if (req.method === "POST") {
    const declared = Number(req.headers.get("content-length"));
    if (declared > MAX_BYTES) throw new HttpError(413, "DXF exceeds the 8 MB limit");
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength === 0) throw new HttpError(400, "empty request body");
    if (buf.byteLength > MAX_BYTES) throw new HttpError(413, "DXF exceeds the 8 MB limit");
    return buf;
  }
  const src = url.searchParams.get("src");
  if (!src) throw new HttpError(400, "provide `?src=<dxf-url>` or POST the DXF as the body");
  return fetchDxf(src);
}

function handleDescribe(bytes: Uint8Array): Response {
  const doc = parseDxfBytes(bytes);
  return json(describeDrawing(doc, tessellate(doc, {})));
}

async function handleRender(bytes: Uint8Array, url: URL, renderPng: RenderPng): Promise<Response> {
  const format = (url.searchParams.get("format") ?? "png").toLowerCase();
  if (format !== "png" && format !== "svg") throw new HttpError(400, "format must be png or svg");
  const bgParam = url.searchParams.get("bg");
  // `bg` is interpolated into the SVG — a strict hex-color whitelist keeps
  // query-string content from breaking out of the fill attribute.
  if (bgParam !== null && bgParam !== "none" && !/^#[0-9a-f]{3,8}$/i.test(bgParam))
    throw new HttpError(400, "bg must be a hex color like %23rrggbb, or none");
  const background = bgParam === "none" ? undefined : (bgParam ?? DEFAULT_BG);

  const doc = parseDxfBytes(bytes);
  const svg = tessellationToSvg(tessellate(doc, {}), undefined, background ? { background } : {});

  if (format === "svg")
    return new Response(svg, {
      headers: { "content-type": "image/svg+xml; charset=utf-8", ...CORS },
    });

  const width = Math.min(
    MAX_WIDTH,
    Math.max(1, Number(url.searchParams.get("width")) || DEFAULT_WIDTH),
  );
  const png = await renderPng(svg, width);
  return new Response(png as unknown as BodyInit, {
    headers: { "content-type": "image/png", ...CORS },
  });
}

/** The full request router — pure except for the injected `renderPng`. */
export async function handleRequest(
  req: Request,
  renderPng: RenderPng,
  checkRateLimit?: CheckRateLimit,
  widgetHtml?: string,
): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS")
    return new Response(null, {
      headers: {
        ...CORS,
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "*",
      },
    });

  try {
    // Rate-limit only the endpoints that do real work, keyed per client IP
    // (cf-connecting-ip is set by Cloudflare's edge and can't be spoofed).
    if (WORK_ENDPOINTS.has(url.pathname) && checkRateLimit) {
      const key = req.headers.get("cf-connecting-ip") ?? "unknown";
      if (!(await checkRateLimit(key)))
        throw new HttpError(429, "rate limit exceeded — try again shortly");
    }
    switch (url.pathname) {
      case "/health":
        return json({ status: "ok" });
      case "/openapi.json":
        // Advertise whichever host served the doc — the API answers on more
        // than one domain, and a hardcoded URL lies on all but one of them.
        return json({ ...openapi, servers: [{ url: url.origin }] });
      case "/":
        return json({
          name: "aspicio-api",
          openapi: "/openapi.json",
          endpoints: {
            "GET|POST /describe": "structured JSON summary of a DXF (?src=<url> or POST body)",
            "GET|POST /render": "?format=png|svg&width=&bg=  — render a DXF to an image",
          },
        });
      case "/mcp":
        // Remote MCP (Streamable HTTP, stateless) — the connector endpoint
        // for Claude.ai and other web clients.
        return await handleMcp(req, renderPng, widgetHtml);
      case "/describe":
        return handleDescribe(await resolveDxf(req, url));
      case "/render":
        // `await` matters: without it a rejection inside handleRender would
        // escape this try/catch and surface as an unhandled 500.
        return await handleRender(await resolveDxf(req, url), url, renderPng);
      default:
        return json({ error: "not found" }, 404);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      const res = json({ error: err.message }, err.status);
      // Well-behaved clients back off on this; 60 = the bucket period.
      if (err.status === 429) res.headers.set("retry-after", "60");
      return res;
    }
    return json({ error: `could not process DXF: ${(err as Error).message}` }, 422);
  }
}
