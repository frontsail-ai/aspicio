import { describeDrawing, parseDxfBytes, tessellate, tessellationToSvg } from "@aspicio/core";

const MAX_BYTES = 8 * 1024 * 1024; // reject DXF payloads larger than 8 MB
const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_BG = "#16181d";
const DEFAULT_WIDTH = 1200;
const MAX_WIDTH = 4000;

/** Rasterize an SVG string to PNG bytes. Injected so the runtime-specific
 * (WASM) rasterizer stays out of the testable request logic. */
export type RenderPng = (svg: string, width: number) => Promise<Uint8Array>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const CORS = { "access-control-allow-origin": "*" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

/** Best-effort block of loopback / link-local / private hosts (SSRF guard). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "[::1]"
  )
    return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}

async function fetchDxf(src: string): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    throw new HttpError(400, "`src` is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new HttpError(400, "`src` must be an http(s) URL");
  if (isPrivateHost(url.hostname))
    throw new HttpError(400, "refusing to fetch a private or loopback address");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new HttpError(502, `failed to fetch ${url}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new HttpError(413, "DXF exceeds the 8 MB limit");
    return buf;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, `failed to fetch ${url}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve the DXF bytes from a GET `?src=` URL or a POST request body. */
async function resolveDxf(req: Request, url: URL): Promise<Uint8Array> {
  if (req.method === "POST") {
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
export async function handleRequest(req: Request, renderPng: RenderPng): Promise<Response> {
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
    switch (url.pathname) {
      case "/health":
        return json({ status: "ok" });
      case "/":
        return json({
          name: "aspicio-api",
          endpoints: {
            "GET|POST /describe": "structured JSON summary of a DXF (?src=<url> or POST body)",
            "GET|POST /render": "?format=png|svg&width=&bg=  — render a DXF to an image",
          },
        });
      case "/describe":
        return handleDescribe(await resolveDxf(req, url));
      case "/render":
        return handleRender(await resolveDxf(req, url), url, renderPng);
      default:
        return json({ error: "not found" }, 404);
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: `could not process DXF: ${(err as Error).message}` }, 422);
  }
}
