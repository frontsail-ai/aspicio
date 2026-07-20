import { describeDrawing, parseDxfBytes, tessellate, tessellationToSvg } from "@aspicio/core";
import { openapi } from "./openapi.ts";

const MAX_BYTES = 8 * 1024 * 1024; // reject DXF payloads larger than 8 MB
const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_BG = "#16181d";
const DEFAULT_WIDTH = 1200;
const MAX_WIDTH = 4000;

/** Rasterize an SVG string to PNG bytes. Injected so the runtime-specific
 * (WASM) rasterizer stays out of the testable request logic. */
export type RenderPng = (svg: string, width: number) => Promise<Uint8Array>;

/** Per-caller rate check: true = allowed. Injected (the binding is runtime). */
export type CheckRateLimit = (key: string) => Promise<boolean>;

/** Endpoints that do real work (fetch/parse/rasterize) and get rate-limited. */
const WORK_ENDPOINTS = new Set(["/describe", "/render"]);

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

/**
 * Best-effort block of loopback / link-local / private hosts (SSRF guard).
 * The URL parser has already canonicalized numeric IPv4 forms (decimal, octal,
 * hex) to dotted quads, so matching the parsed hostname covers those. DNS
 * rebinding (a public name resolving to a private address) cannot be closed
 * here — Workers offer no resolve-then-pin — so the platform's own egress
 * restrictions are the real backstop for that case.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0") return true;
  if (h.includes(":")) {
    // IPv6: loopback/unspecified/IPv4-mapped (all canonicalize to a "::"
    // prefix), unique-local fc00::/7, and link-local fe80::/10.
    return h.startsWith("::") || /^(fc|fd)/.test(h) || /^fe[89ab]/.test(h) || /^0+:/.test(h);
  }
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

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Parse + protocol + private-host validation, applied to every redirect hop. */
function validateSrcUrl(src: string, base?: URL): URL {
  let url: URL;
  try {
    url = base ? new URL(src, base) : new URL(src);
  } catch {
    throw new HttpError(400, "`src` is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new HttpError(400, "`src` must be an http(s) URL");
  if (isPrivateHost(url.hostname))
    throw new HttpError(400, "refusing to fetch a private or loopback address");
  return url;
}

async function fetchDxf(src: string): Promise<Uint8Array> {
  let url = validateSrcUrl(src);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Follow redirects manually so every hop passes the SSRF guard — a public
    // URL redirecting to a private address must be rejected, not followed.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(url.toString(), { signal: controller.signal, redirect: "manual" });
      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get("location");
        if (!location) throw new HttpError(502, `redirect from ${url} without a location`);
        url = validateSrcUrl(location, url);
        continue;
      }
      if (!res.ok) throw new HttpError(502, `failed to fetch ${url}: HTTP ${res.status}`);
      const declared = Number(res.headers.get("content-length"));
      if (declared > MAX_BYTES) throw new HttpError(413, "DXF exceeds the 8 MB limit");
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) throw new HttpError(413, "DXF exceeds the 8 MB limit");
      return buf;
    }
    throw new HttpError(502, "too many redirects");
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
        return json(openapi);
      case "/":
        return json({
          name: "aspicio-api",
          openapi: "/openapi.json",
          endpoints: {
            "GET|POST /describe": "structured JSON summary of a DXF (?src=<url> or POST body)",
            "GET|POST /render": "?format=png|svg&width=&bg=  — render a DXF to an image",
          },
        });
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
