import { existsSync, readFileSync } from "node:fs";
import {
  describeDrawing,
  type DrawingDocument,
  type DrawingSummary,
  parseWith,
  tessellateSpace,
  tessellationToSvg,
} from "@aspicio/core";
import { dxfParser } from "@aspicio/core/dxf";
import { pdfParser } from "@aspicio/core/pdf";
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

async function fetchDrawing(src: string): Promise<Uint8Array> {
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
export async function loadDrawing(source: string): Promise<Uint8Array> {
  const s = source.trim();
  if (/^https?:\/\//i.test(s)) return fetchDrawing(s);
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

/**
 * The parsers each tool family accepts (AGT-16).
 *
 * The typed pairs let an agent state what it believes it has; the agnostic
 * pair lets it decline to guess. Handing a typed tool the wrong format fails
 * with a message naming the tool that would have worked.
 */
const DXF_ONLY = [dxfParser];
const PDF_ONLY = [pdfParser];
const ANY_FORMAT = [dxfParser, pdfParser];

/**
 * Parse for one tool family, improving the error when the bytes are a format
 * some *other* tool handles.
 */
async function parseFor(
  parsers: readonly (typeof dxfParser)[],
  bytes: Uint8Array,
  suffix: string,
): Promise<DrawingDocument> {
  try {
    return await parseWith(parsers, bytes);
  } catch (error) {
    const other = ANY_FORMAT.find((p) => !parsers.includes(p) && p.sniff(bytes));
    if (other)
      throw new Error(
        `This is a ${other.format.toUpperCase()} file. Use describe_${other.format} or render_${other.format}${suffix}.`,
      );
    throw error;
  }
}

/** Structured JSON summary of DXF bytes. */
export async function describeDxf(bytes: Uint8Array, space?: string): Promise<DrawingSummary> {
  const doc = await parseFor(DXF_ONLY, bytes, "");
  return describeDrawing(doc, { space });
}

/** Render DXF bytes to a PNG (SVG → resvg). */
export async function renderPng(
  bytes: Uint8Array,
  width = DEFAULT_WIDTH,
  space?: string,
): Promise<Uint8Array> {
  const doc = await parseFor(DXF_ONLY, bytes, "");
  return toPng(doc, width, space);
}

/** Structured JSON summary of PDF bytes. */
export async function describePdf(bytes: Uint8Array, space?: string): Promise<DrawingSummary> {
  const doc = await parseFor(PDF_ONLY, bytes, "");
  return describeDrawing(doc, { space });
}

/** Render PDF bytes to a PNG. */
export async function renderPdfPng(
  bytes: Uint8Array,
  width = DEFAULT_WIDTH,
  space?: string,
): Promise<Uint8Array> {
  const doc = await parseFor(PDF_ONLY, bytes, "");
  return toPng(doc, width, space);
}

/** Structured JSON summary of any supported drawing, detected from the bytes. */
export async function describeDoc(bytes: Uint8Array, space?: string): Promise<DrawingSummary> {
  const doc = await parseWith(ANY_FORMAT, bytes);
  return describeDrawing(doc, { space });
}

/** Render any supported drawing to a PNG, detected from the bytes. */
export async function renderDocPng(
  bytes: Uint8Array,
  width = DEFAULT_WIDTH,
  space?: string,
): Promise<Uint8Array> {
  const doc = await parseWith(ANY_FORMAT, bytes);
  return toPng(doc, width, space);
}

function toPng(doc: DrawingDocument, width: number, space?: string): Uint8Array {
  const svg = tessellationToSvg(tessellateSpace(doc, space), undefined, { background: DEFAULT_BG });
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
}
