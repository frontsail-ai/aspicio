import { existsSync, readFileSync } from "node:fs";
import {
  describeDrawing,
  type DrawingSummary,
  parseDxfBytes,
  tessellate,
  tessellationToSvg,
} from "@aspicio/core";
import { Resvg } from "@resvg/resvg-js";

const DEFAULT_BG = "#16181d";
const DEFAULT_WIDTH = 1200;
const MAX_BYTES = 8 * 1024 * 1024; // cap fetched DXF payloads at 8 MB
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Best-effort block of loopback / link-local / private hosts. An MCP tool is
 * driven by a model that may be acting on untrusted input, so "describe the
 * drawing at http://169.254.169.254/…" must not turn this server into a
 * LAN/localhost probe. Mirrors apps/api's guard — consolidating both into a
 * shared core helper is a noted follow-up.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0") return true;
  if (h.includes(":")) {
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

function validateUrl(src: string, base?: URL): URL {
  const url = base ? new URL(src, base) : new URL(src);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("only http(s) URLs can be fetched");
  if (isPrivateHost(url.hostname))
    throw new Error("refusing to fetch a private or loopback address");
  return url;
}

async function fetchDxf(src: string): Promise<Uint8Array> {
  let url = validateUrl(src);
  // Follow redirects manually so every hop passes the private-host guard.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url.toString(), { redirect: "manual" });
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`redirect from ${url.href} without a location`);
      url = validateUrl(location, url);
      continue;
    }
    if (!res.ok) throw new Error(`failed to fetch ${url.href}: HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length"));
    if (declared > MAX_BYTES) throw new Error("DXF exceeds the 8 MB limit");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error("DXF exceeds the 8 MB limit");
    return buf;
  }
  throw new Error("too many redirects");
}

/**
 * Resolve a `source` to DXF bytes. Accepts an http(s) URL (fetched with a
 * private-host guard), a local file path (read), or inline DXF text.
 */
export async function loadDxf(source: string): Promise<Uint8Array> {
  const s = source.trim();
  if (/^https?:\/\//i.test(s)) return fetchDxf(s);
  // A path is a single short line; check the filesystem before any content
  // heuristics so real paths win even when they contain words like SECTION.
  if (!source.includes("\n") && s.length < 4096) {
    if (existsSync(s)) return new Uint8Array(readFileSync(s));
    // Path-shaped but nothing there: say so instead of surfacing a confusing
    // parse error from treating the path string as DXF content.
    if (!/\bSECTION\b|\bEOF\b/.test(s)) throw new Error(`file not found: ${s}`);
  }
  return new TextEncoder().encode(source);
}

/** Structured JSON summary of DXF bytes. */
export function describeDxf(bytes: Uint8Array): DrawingSummary {
  const doc = parseDxfBytes(bytes);
  return describeDrawing(doc, tessellate(doc, {}));
}

/** Render DXF bytes to a PNG (SVG → resvg). */
export function renderPng(bytes: Uint8Array, width = DEFAULT_WIDTH): Uint8Array {
  const doc = parseDxfBytes(bytes);
  const svg = tessellationToSvg(tessellate(doc, {}), undefined, { background: DEFAULT_BG });
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
}
