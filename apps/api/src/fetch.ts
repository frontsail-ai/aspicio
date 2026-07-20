/**
 * Guarded outbound fetching for caller-supplied DXF URLs, shared by the HTTP
 * endpoints and the remote MCP tools — one copy of the SSRF policy.
 */

export const MAX_BYTES = 8 * 1024 * 1024; // reject DXF payloads larger than 8 MB
const FETCH_TIMEOUT_MS = 10_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
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

export async function fetchDxf(src: string): Promise<Uint8Array> {
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
