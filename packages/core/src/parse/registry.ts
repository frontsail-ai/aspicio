/**
 * Format registry (PARSE-13).
 *
 * Core parses nothing on its own: a caller injects the parsers it wants and
 * this module picks between them by sniffing bytes. That indirection is what
 * keeps every format behind its own entry point (INV-11) — nothing here
 * imports a parser, so nothing here drags one into a bundle.
 */

import type { DrawingDocument } from "../model/types.ts";
import { DrawingParseError } from "./errors.ts";

/** One file format's contribution: a name, a byte sniff, and a parse. */
export interface DrawingParser {
  /** Short lowercase format name, e.g. "dxf". Surfaces report it verbatim. */
  format: string;
  /**
   * True when this parser claims the bytes. Sniffs see the whole buffer but
   * should only look at the head — they run on every load, for every parser.
   */
  sniff(bytes: Uint8Array): boolean;
  /** Parse claimed bytes, or throw a `DrawingParseError` carrying `format`. */
  parse(bytes: Uint8Array): DrawingDocument | Promise<DrawingDocument>;
}

/** Everything a drawing can be loaded from (PARSE-1). */
export type DrawingSource = string | ArrayBuffer | Uint8Array | Blob;

const utf8 = new TextEncoder();

/** Normalize any accepted source to bytes, so sniffs see one shape (PARSE-1). */
export async function toBytes(source: DrawingSource): Promise<Uint8Array> {
  if (typeof source === "string") return utf8.encode(source);
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(await source.arrayBuffer());
}

/** True when the buffer holds nothing but ASCII whitespace (or nothing). */
function isBlank(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    // space, tab, LF, CR, FF, VT — anything else counts as content.
    if (byte !== 0x20 && (byte < 0x09 || byte > 0x0d)) return false;
  }
  return true;
}

/**
 * Parse `source` with the first parser whose sniff claims it (PARSE-13).
 *
 * Sniffs run in the order given, so a caller controls precedence by ordering
 * its list. No parser claiming the bytes is a clean, honest failure, not a
 * fallback attempt at every parser in turn (PARSE-12).
 */
export async function parseWith(
  parsers: readonly DrawingParser[],
  source: DrawingSource,
): Promise<DrawingDocument> {
  const bytes = await toBytes(source);
  if (isBlank(bytes)) throw new DrawingParseError("The file is empty");
  if (parsers.length === 0) {
    throw new DrawingParseError(
      'No format parsers configured — pass `parsers: [dxfParser]` from "@aspicio/core/dxf"',
    );
  }
  for (const parser of parsers) {
    if (parser.sniff(bytes)) return await parser.parse(bytes);
  }
  throw new DrawingParseError("Not a supported drawing file");
}
