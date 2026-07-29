/**
 * @aspicio/core/dxf — the DXF format, and nothing else.
 *
 * This is the only module that reaches the DXF parser (INV-11). Import it to
 * teach a viewer or a headless surface how to read DXF:
 *
 * ```ts
 * import { DrawingViewer } from "@aspicio/core";
 * import { dxfParser } from "@aspicio/core/dxf";
 *
 * const viewer = new DrawingViewer(el, { parsers: [dxfParser] });
 * ```
 *
 * Nothing here self-registers: the module exports values and has no side
 * effects, so a bundle that never imports it carries no DXF code.
 */

import type { DrawingParser } from "./parse/registry.ts";
import { DXF_FORMAT, parseDxfBytes, sniffDxf } from "./parse/parse.ts";

/** The DXF parser, ready to pass to `parsers` (VIEW-15) or `parseWith`. */
export const dxfParser: DrawingParser = {
  format: DXF_FORMAT,
  sniff: sniffDxf,
  parse: parseDxfBytes,
};

export { parseDxf, parseDxfBytes, sniffDxf } from "./parse/parse.ts";
export { binaryDxfToText, isBinaryDxf } from "./parse/binary.ts";
