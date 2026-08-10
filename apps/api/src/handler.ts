import {
  UnknownSpaceError,
  describeDrawing,
  parseWith,
  tessellateSpace,
  tessellationToSvg,
} from "@aspicio/core";
import { dxfParser } from "@aspicio/core/dxf";
import { pdfParser } from "@aspicio/core/pdf";
import { fetchDrawing, HttpError, MAX_BYTES } from "./fetch.ts";
import { handleMcp } from "./mcp.ts";
import { openapiDocument } from "./openapi.ts";

const DEFAULT_BG = "#16181d";
const DEFAULT_WIDTH = 1200;
const MAX_WIDTH = 4000;

/** Rasterize an SVG string to PNG bytes. Injected so the runtime-specific
 * (WASM) rasterizer stays out of the testable request logic. */
export type RenderPng = (svg: string, width: number) => Promise<Uint8Array>;

/** Per-caller rate check: true = allowed. Injected (the binding is runtime). */
export type CheckRateLimit = (key: string) => Promise<boolean>;

/** Endpoints that do real work (fetch/parse/rasterize) and get rate-limited. */
const WORK_ENDPOINTS = new Set([
  "/describe",
  "/render",
  "/describe-pdf",
  "/render-pdf",
  "/describe-doc",
  "/render-doc",
  "/mcp",
]);

/**
 * The parsers each endpoint family accepts (AGT-16).
 *
 * The typed endpoints let a caller state the format it believes it has; the
 * agnostic ones let it decline to guess. Handing a typed endpoint the wrong
 * format names the endpoint that would have worked.
 */
const DXF_ONLY = [dxfParser];
const PDF_ONLY = [pdfParser];
const ANY_FORMAT = [dxfParser, pdfParser];

async function parseFor(
  parsers: readonly (typeof dxfParser)[],
  bytes: Uint8Array,
  kind: "describe" | "render",
): Promise<Awaited<ReturnType<typeof parseWith>>> {
  try {
    return await parseWith(parsers, bytes);
  } catch (error) {
    const other = ANY_FORMAT.find((p) => !parsers.includes(p) && p.sniff(bytes));
    if (other)
      throw new HttpError(
        422,
        `this is a ${other.format.toUpperCase()} — use /${kind}-${other.format}`,
      );
    throw error;
  }
}

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
  return fetchDrawing(src);
}

/**
 * `space` names one page/layout to work on; absent means the whole drawing for
 * describe and the first space for render. An unknown name is a 400 rather
 * than a silent fallback — a caller asking for page 7 of a 6-page file has a
 * bug, and answering with page 1 hides it (AGT-5).
 */
function spaceParam(url: URL): string | undefined {
  return url.searchParams.get("space") ?? undefined;
}

async function handleDescribe(
  bytes: Uint8Array,
  url: URL,
  parsers: readonly (typeof dxfParser)[],
): Promise<Response> {
  const doc = await parseFor(parsers, bytes, "describe");
  return json(describeDrawing(doc, { space: spaceParam(url) }));
}

async function handleRender(
  bytes: Uint8Array,
  url: URL,
  renderPng: RenderPng,
  parsers: readonly (typeof dxfParser)[],
): Promise<Response> {
  const format = (url.searchParams.get("format") ?? "png").toLowerCase();
  if (format !== "png" && format !== "svg") throw new HttpError(400, "format must be png or svg");
  const bgParam = url.searchParams.get("bg");
  // `bg` is interpolated into the SVG — a strict hex-color whitelist keeps
  // query-string content from breaking out of the fill attribute.
  if (bgParam !== null && bgParam !== "none" && !/^#[0-9a-f]{3,8}$/i.test(bgParam))
    throw new HttpError(400, "bg must be a hex color like %23rrggbb, or none");
  const background = bgParam === "none" ? undefined : (bgParam ?? DEFAULT_BG);

  const doc = await parseFor(parsers, bytes, "render");
  const svg = tessellationToSvg(
    tessellateSpace(doc, spaceParam(url)),
    undefined,
    background ? { background } : {},
  );

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
      case "/.well-known/openai-apps-challenge":
        // OpenAI app-directory domain verification: the console-issued token
        // must be served verbatim at this exact path (public by design).
        return new Response("1gAK8NA4X6b4VCSuHhmSOywdGJD0VQ0oz4NAILnJHX4", {
          headers: { "content-type": "text/plain" },
        });
      case "/.well-known/glama.json":
        // Glama connector ownership verification: the maintainer contact,
        // served on the MCP server's domain (public by design).
        return json({
          $schema: "https://glama.ai/mcp/schemas/connector.json",
          maintainers: [{ email: "dmitri@frontsail.ai" }],
        });
      case "/openapi.json":
        // Advertise whichever host served the doc — the API answers on more
        // than one domain, and a hardcoded URL lies on all but one of them.
        return json({ ...openapiDocument, servers: [{ url: url.origin }] });
      case "/":
        return json({
          name: "aspicio-api",
          openapi: "/openapi.json",
          endpoints: {
            "GET|POST /describe": "structured JSON summary of a DXF (?src=<url> or POST body)",
            "GET|POST /render": "?format=png|svg&width=&bg=  — render a DXF to an image",
            "GET|POST /describe-pdf": "the same, for a PDF",
            "GET|POST /render-pdf": "the same, for a PDF",
            "GET|POST /describe-doc":
              "the same, for any supported format (detected from the bytes)",
            "GET|POST /render-doc": "the same, for any supported format (detected from the bytes)",
          },
        });
      case "/mcp":
        // Remote MCP (Streamable HTTP, stateless) — the connector endpoint
        // for Claude.ai and other web clients.
        return await handleMcp(req, renderPng, widgetHtml);
      case "/describe":
        return await handleDescribe(await resolveDxf(req, url), url, DXF_ONLY);
      case "/describe-pdf":
        return await handleDescribe(await resolveDxf(req, url), url, PDF_ONLY);
      case "/describe-doc":
        return await handleDescribe(await resolveDxf(req, url), url, ANY_FORMAT);
      case "/render":
        // `await` matters: without it a rejection inside handleRender would
        // escape this try/catch and surface as an unhandled 500.
        return await handleRender(await resolveDxf(req, url), url, renderPng, DXF_ONLY);
      case "/render-pdf":
        return await handleRender(await resolveDxf(req, url), url, renderPng, PDF_ONLY);
      case "/render-doc":
        return await handleRender(await resolveDxf(req, url), url, renderPng, ANY_FORMAT);
      default:
        return json({ error: "not found" }, 404);
    }
  } catch (err) {
    // Naming a space the drawing lacks is a bad request, not a broken file —
    // 422 ("could not process") would send the caller looking at their PDF.
    if (err instanceof UnknownSpaceError) return json({ error: err.message }, 400);
    if (err instanceof HttpError) {
      const res = json({ error: err.message }, err.status);
      // Well-behaved clients back off on this; 60 = the bucket period.
      if (err.status === 429) res.headers.set("retry-after", "60");
      return res;
    }
    return json({ error: `could not process DXF: ${(err as Error).message}` }, 422);
  }
}
