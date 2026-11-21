import {
  UnknownSpaceError,
  describeDrawing,
  parseWith,
  tessellateSpace,
  tessellationToSvg,
} from "@aspicio/core";
import type { DrawingParser } from "@aspicio/core";
import type { ToolFormat } from "@aspicio/agent-tools";
import { ENDPOINTS, otherFormat, PARSERS, phraseFor, routeOf } from "./endpoints.ts";
import type { Kind } from "./endpoints.ts";
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
const WORK_ENDPOINTS = new Set<string>([
  ...Object.values(ENDPOINTS).flatMap((paths) => Object.values(paths)),
  "/mcp",
]);

/**
 * A typed endpoint received the other format (AGT-16).
 *
 * The typed endpoints let a caller state the format it believes it has; the
 * agnostic ones let it decline to guess. A POST is told which endpoint would
 * have worked. A GET is redirected there, query intact: a GET is a link, and a
 * link built for the wrong endpoint — every PDF render link the hosted MCP
 * tools handed out before the endpoint table existed — should still resolve.
 */
class WrongFormat extends Error {
  /** The endpoint that reads this drawing. */
  readonly path: string;

  constructor(kind: Kind, format: Exclude<ToolFormat, "doc">) {
    const path = ENDPOINTS[kind][format];
    super(`this is a ${format.toUpperCase()} — use ${path}`);
    this.path = path;
  }
}

async function parseFor(
  parsers: readonly DrawingParser[],
  bytes: Uint8Array,
  kind: Kind,
): Promise<Awaited<ReturnType<typeof parseWith>>> {
  try {
    return await parseWith(parsers, bytes);
  } catch (error) {
    const other = otherFormat(parsers, bytes);
    if (other) throw new WrongFormat(kind, other);
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

/**
 * Error wording, written for the DXF endpoints and rephrased for the others
 * by the same rules as the OpenAPI document (INV-12). A PDF endpoint that
 * answered "DXF exceeds the 8 MB limit" sent its caller to check the wrong
 * file.
 */
const TOO_LARGE = "DXF exceeds the 8 MB limit";
const NO_SOURCE = "provide `?src=<url>` or POST the DXF as the body";
const UNREADABLE = "could not process the DXF";

/** Resolve the drawing's bytes from a GET `?src=` URL or a POST request body. */
async function resolveDrawing(req: Request, url: URL, format: ToolFormat): Promise<Uint8Array> {
  const tooLarge = phraseFor(format, TOO_LARGE);
  if (req.method === "POST") {
    const declared = Number(req.headers.get("content-length"));
    if (declared > MAX_BYTES) throw new HttpError(413, tooLarge);
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength === 0) throw new HttpError(400, "empty request body");
    if (buf.byteLength > MAX_BYTES) throw new HttpError(413, tooLarge);
    return buf;
  }
  const src = url.searchParams.get("src");
  if (!src) throw new HttpError(400, phraseFor(format, NO_SOURCE));
  return fetchDrawing(src, tooLarge);
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
  parsers: readonly DrawingParser[],
): Promise<Response> {
  const doc = await parseFor(parsers, bytes, "describe");
  return json(describeDrawing(doc, { space: spaceParam(url) }));
}

async function handleRender(
  bytes: Uint8Array,
  url: URL,
  renderPng: RenderPng,
  parsers: readonly DrawingParser[],
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
  const svg = tessellationToSvg(tessellateSpace(doc, spaceParam(url)), undefined, {
    ...(background ? { background } : {}),
    // Paper under a bounded page, matching the canvas (VIEW-12, VIEW-17).
    // `bg` still controls the surround; a space with no page box is
    // unaffected, so DXF output is unchanged. `bg=none` keeps the surround
    // transparent while the page itself stays opaque, which is what makes a
    // page render usable on an arbitrary backdrop.
    sheet: "#ffffff",
  });

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
  // The endpoint's format, once routed: it words the catch-all 422 below.
  let format: ToolFormat = "dxf";
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
        return json({ name: "aspicio-api", openapi: "/openapi.json", endpoints: INDEX });
      case "/mcp":
        // Remote MCP (Streamable HTTP, stateless) — the connector endpoint
        // for Claude.ai and other web clients.
        return await handleMcp(req, renderPng, widgetHtml);
    }
    const route = routeOf(url.pathname);
    if (!route) return json({ error: "not found" }, 404);
    format = route.format;
    const bytes = await resolveDrawing(req, url, route.format);
    // `await` matters: without it a rejection inside the handler would escape
    // this try/catch and surface as an unhandled 500.
    return route.kind === "describe"
      ? await handleDescribe(bytes, url, PARSERS[route.format])
      : await handleRender(bytes, url, renderPng, PARSERS[route.format]);
  } catch (err) {
    // Naming a space the drawing lacks is a bad request, not a broken file —
    // 422 ("could not process") would send the caller looking at their PDF.
    if (err instanceof UnknownSpaceError) return json({ error: err.message }, 400);
    if (err instanceof WrongFormat) {
      if (req.method === "GET")
        return new Response(null, {
          status: 307,
          headers: { location: `${err.path}${url.search}`, ...CORS },
        });
      return json({ error: err.message }, 422);
    }
    if (err instanceof HttpError) {
      const res = json({ error: err.message }, err.status);
      // Well-behaved clients back off on this; 60 = the bucket period.
      if (err.status === 429) res.headers.set("retry-after", "60");
      return res;
    }
    return json({ error: `${phraseFor(format, UNREADABLE)}: ${(err as Error).message}` }, 422);
  }
}

/** What each drawing endpoint does, keyed and ordered like the table. */
const INDEX_PROSE: Record<Kind, Record<ToolFormat, string>> = {
  describe: {
    dxf: "structured JSON summary of a DXF (?src=<url> or POST body)",
    pdf: "the same, for a PDF",
    doc: "the same, for any supported format (detected from the bytes)",
  },
  render: {
    dxf: "?format=png|svg&width=&bg=  — render a DXF to an image",
    pdf: "the same, for a PDF",
    doc: "the same, for any supported format (detected from the bytes)",
  },
};

/** The `/` listing: by format, then kind — describe-pdf before render-pdf. */
const INDEX = Object.fromEntries(
  (Object.keys(ENDPOINTS.describe) as ToolFormat[]).flatMap((format) =>
    (Object.keys(ENDPOINTS) as Kind[]).map((kind) => [
      `GET|POST ${ENDPOINTS[kind][format]}`,
      INDEX_PROSE[kind][format],
    ]),
  ),
);
