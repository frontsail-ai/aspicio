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

/**
 * Resolve a `source` to DXF bytes. Accepts an http(s) URL (fetched), a local
 * file path (read), or inline DXF text.
 */
export async function loadDxf(source: string): Promise<Uint8Array> {
  const s = source.trim();
  if (/^https?:\/\//i.test(s)) {
    const res = await fetch(s);
    if (!res.ok) throw new Error(`failed to fetch ${s}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  // Multi-line or DXF-looking content is inline text, never a path.
  const looksInline = source.includes("\n") || /\bSECTION\b|\bENTITIES\b|\bEOF\b/.test(s);
  if (!looksInline && s.length < 4096 && existsSync(s)) return new Uint8Array(readFileSync(s));
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
