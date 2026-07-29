/**
 * @aspicio/core/pdf — the PDF format, and nothing else.
 *
 * This is the only module that reaches the PDF parser (INV-11). Import it to
 * teach a viewer or a headless surface how to read PDF:
 *
 * ```ts
 * import { DrawingViewer } from "@aspicio/core";
 * import { pdfParser } from "@aspicio/core/pdf";
 *
 * const viewer = new DrawingViewer(el, { parsers: [pdfParser] });
 * ```
 *
 * Nothing here self-registers: the module exports values and has no side
 * effects, so a bundle that never imports it carries no PDF code — and a
 * DXF-only bundle carries none of it either.
 */

import type { DrawingParser } from "./parse/registry.ts";
import { PDF_FORMAT } from "./parse/pdf/document.ts";
import { parsePdfBytes, sniffPdf } from "./parse/pdf/parse.ts";

/** The PDF parser, ready to pass to `parsers` (VIEW-15) or `parseWith`. */
export const pdfParser: DrawingParser = {
  format: PDF_FORMAT,
  sniff: sniffPdf,
  parse: parsePdfBytes,
};

export { parsePdfBytes, sniffPdf } from "./parse/pdf/parse.ts";
export type { ParsePdfOptions } from "./parse/pdf/parse.ts";
