/**
 * PDF → `DrawingDocument` (PDF-5, PDF-6, PDF-7).
 *
 * The last step of PDF parsing: run every page through the interpreter and
 * assemble one document in the shape the rest of the pipeline already
 * understands. Nothing below this file knows a second format exists.
 */

import type { DrawingDocument, Entity, LayerInfo, LineTypeDef, Layout } from "../../model/types.ts";
import { PDF_FORMAT, PdfDocument, pdfError } from "./document.ts";
import { checkStrictGate } from "./gate.ts";
import { CONTENT_LAYER, IDENTITY, interpretContent, multiply } from "./interpret.ts";
import type { ImageCache } from "./image.ts";
import { readOptionalContent } from "./optional-content.ts";
import type { InterpretOptions, Matrix } from "./interpret.ts";
import { toNumber } from "./objects.ts";
import type { PdfDict } from "./objects.ts";

/** PDF measures in points, and nothing rescales it (PDF-6). */
const PDF_UNITS = "pt";

/** The colour the "Content" layer reports before tessellation resolves it. */
const CONTENT_LAYER_COLOR = 0xffffff;

export interface ParsePdfOptions extends InterpretOptions {}

/**
 * Parse PDF bytes into a drawing document.
 *
 * Page 1 becomes model space and later pages become named spaces, because the
 * viewer opens model space on load — a PDF whose first page lived in a layout
 * would open blank.
 */
export async function parsePdfBytes(
  source: Uint8Array,
  options: ParsePdfOptions = {},
): Promise<DrawingDocument> {
  const doc = await PdfDocument.parse(source);
  await checkStrictGate(doc);

  const pages = await doc.pages();
  if (pages.length === 0) throw pdfError("This PDF has no pages");

  const entities: Entity[] = [];
  const layouts: Layout[] = [];
  const lineTypes = new Map<string, LineTypeDef>();
  const unsupported: Record<string, number> = {};

  // Read once for the document: a group referenced from several pages is one
  // layer, not one per page (PDF-7).
  const optionalContent = await readOptionalContent(doc, await doc.catalog(), unsupported);
  // One decode per image object across all pages (PDF-9).
  const imageCache: ImageCache = new Map();

  for (const [index, page] of pages.entries()) {
    const content = await doc.pageContent(page);
    // Decoding reports rather than throws, so a page whose content would not
    // decode arrives as empty bytes. That is indistinguishable from a blank
    // page by content alone — but a page that *had* streams and yielded
    // nothing is one we failed to read, and PDF-8 requires saying so.
    if (content.length === 0 && (await doc.contentStreams(page)).length > 0)
      unsupported["UnreadablePage"] = (unsupported["UnreadablePage"] ?? 0) + 1;

    // Interpretation itself still gets a page-level boundary: a page that
    // fails for any *other* reason costs that page, never the document.
    let result: Awaited<ReturnType<typeof interpretContent>>;
    try {
      const resources = await doc.dict(page.get("Resources"));
      result = await interpretContent(
        doc,
        content,
        resources,
        { ...options, optionalContent, imageCache },
        await pageMatrix(doc, page),
      );
    } catch {
      unsupported["UnreadablePage"] = (unsupported["UnreadablePage"] ?? 0) + 1;
      if (index > 0) layouts.push({ name: `Page ${index + 1}`, entities: [], viewports: [] });
      continue;
    }

    for (const [name, def] of result.lineTypes) {
      // Dash names are generated per page, so two pages can both produce
      // `__dash_0` for different patterns; keep the first and re-point the
      // rest rather than letting a later page silently redefine one.
      if (!lineTypes.has(name)) lineTypes.set(name, def);
      else if (!samePattern(lineTypes.get(name) as LineTypeDef, def)) {
        const unique = uniqueName(lineTypes, name);
        lineTypes.set(unique, { ...def, name: unique });
        retarget(result.entities, name, unique);
      }
    }
    for (const [kind, count] of Object.entries(result.unsupported))
      unsupported[kind] = (unsupported[kind] ?? 0) + count;

    if (index === 0) entities.push(...result.entities);
    else layouts.push({ name: `Page ${index + 1}`, entities: result.entities, viewports: [] });
  }

  // A partially decoded stream drew partial content; say so rather than let a
  // describe imply the drawing is complete (PDF-8).
  if (doc.truncatedStreams > 0) unsupported["TruncatedStream"] = doc.truncatedStreams;

  // Entity counts per layer; every group gets a row even when nothing drew on
  // it, so the panel reports what the file declares (PDF-7).
  const counts = new Map<string, number>();
  for (const entity of entities) counts.set(entity.layer, (counts.get(entity.layer) ?? 0) + 1);
  for (const layout of layouts)
    for (const entity of layout.entities)
      counts.set(entity.layer, (counts.get(entity.layer) ?? 0) + 1);

  const layers = new Map<string, LayerInfo>();
  const addLayer = (name: string, visible: boolean): void => {
    layers.set(name, {
      name,
      // A PDF has no layer table, so this is a placeholder; the colours drawn
      // populate effectiveColors after tessellation (INV-2).
      color: CONTENT_LAYER_COLOR,
      visible,
      frozen: false,
      entityCount: counts.get(name) ?? 0,
    });
  };
  for (const layer of optionalContent.layers) addLayer(layer.name, layer.visible);
  // "Content" is the home for unmarked content, which real files have in
  // quantity — three corpus files are entirely unmarked. It appears when it
  // holds something, or when nothing else does, so a fully-layered file does
  // not gain a row the file never declared and a drawing always has a layer.
  const unmarked = counts.get(CONTENT_LAYER) ?? 0;
  if (!layers.has(CONTENT_LAYER) && (unmarked > 0 || layers.size === 0))
    addLayer(CONTENT_LAYER, true);

  return {
    layers,
    entities,
    blocks: new Map(),
    lineTypes,
    unsupported,
    units: PDF_UNITS,
    layouts,
    format: PDF_FORMAT,
  };
}

const samePattern = (a: LineTypeDef, b: LineTypeDef): boolean =>
  a.pattern.length === b.pattern.length && a.pattern.every((v, i) => v === b.pattern[i]);

function uniqueName(existing: ReadonlyMap<string, LineTypeDef>, base: string): string {
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}

function retarget(entities: Entity[], from: string, to: string): void {
  for (const entity of entities) if (entity.lineType === from) entity.lineType = to;
}

/**
 * The base transform for a page, honouring `/Rotate`.
 *
 * A landscape or scanned page carries its orientation as a quarter-turn on the
 * page rather than in its content. Ignoring it renders the drawing sideways
 * while reporting nothing amiss — so it is applied, not counted. The rotation
 * is about the page box's centre, so content stays where the producer put it.
 */
async function pageMatrix(doc: PdfDocument, page: PdfDict): Promise<Matrix> {
  const raw = toNumber(await doc.resolve(page.get("Rotate")));
  // Only quarter turns are legal, and negatives are permitted.
  const angle = (((Math.round(raw / 90) * 90) % 360) + 360) % 360;
  if (angle === 0) return IDENTITY;

  const box = (await doc.array(page.get("MediaBox"))).map((v) => toNumber(v));
  const [x0, y0, x1, y1] = box.length === 4 ? box : [0, 0, 0, 0];
  const width = Math.abs((x1 as number) - (x0 as number));
  const height = Math.abs((y1 as number) - (y0 as number));

  // Rotate clockwise (PDF's positive direction) and translate the result back
  // into the positive quadrant so bounds stay where a reader expects them.
  const rotation: Matrix =
    angle === 90
      ? [0, -1, 1, 0, 0, width]
      : angle === 180
        ? [-1, 0, 0, -1, width, height]
        : [0, 1, -1, 0, height, 0];
  return multiply(IDENTITY, rotation);
}

/** True when the bytes start with a PDF header (PARSE-13's sniff). */
export function sniffPdf(bytes: Uint8Array): boolean {
  // The header is normally at offset 0, but a leading preamble is common
  // enough that the spec itself allows scanning the first kilobyte.
  const limit = Math.min(bytes.length, 1024);
  for (let i = 0; i + 4 < limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    )
      return true;
  }
  return false;
}
