/**
 * The strict gate (PDF-1).
 *
 * Three conditions refuse a file outright, because loading anyway would
 * silently misrepresent the drawing rather than merely simplify it. Everything
 * else this build cannot draw is counted instead (PDF-8) — the gate is
 * deliberately narrow, and each refusal here has to earn its place.
 */

import { pdfError } from "./document.ts";
import type { PdfDocument, PdfStream } from "./document.ts";
import { isStream } from "./document.ts";
import { PdfLexer, isKeyword, isName, isRef } from "./objects.ts";
import type { PdfDict, PdfValue } from "./objects.ts";

/** Text-showing operators — the ones that make a font's absence matter. */
const SHOW_TEXT = new Set(["Tj", "TJ", "'", '"']);

/** Bound on form recursion: a cyclic form graph must not hang the gate. */
const MAX_FORM_DEPTH = 8;

/**
 * Refuse a PDF this build cannot honestly read.
 *
 * Runs before any interpretation, so a rejected file costs one pass over the
 * content rather than a full parse.
 */
export async function checkStrictGate(doc: PdfDocument): Promise<void> {
  if (doc.trailerValue("Encrypt") !== undefined) throw pdfError("Encrypted PDFs are not supported");

  const seenForms = new Set<number>();
  for (const page of await doc.pages()) {
    const resources = await doc.dict(page.get("Resources"));
    await checkContent(doc, await doc.pageContent(page), resources, seenForms, 0);
  }
}

/**
 * Walk one content stream, following forms, checking the two content-level
 * refusals: fonts whose glyphs are missing, and content stored in another file.
 */
async function checkContent(
  doc: PdfDocument,
  content: Uint8Array,
  resources: PdfDict | undefined,
  seenForms: Set<number>,
  depth: number,
): Promise<void> {
  if (depth > MAX_FORM_DEPTH) return;

  const fonts = await doc.dict(resources?.get("Font"));
  const xobjects = await doc.dict(resources?.get("XObject"));

  const lexer = new PdfLexer(content);
  let operands: PdfValue[] = [];
  // Tracked exactly as an interpreter would: the gate cares which font was
  // selected when text is actually shown, not which fonts were declared.
  let currentFont: string | undefined;
  const checkedFonts = new Set<string>();

  while (!lexer.atEnd) {
    lexer.skipSpace();
    if (lexer.atEnd) break;
    const before = lexer.pos;
    const value = lexer.parseObject();
    if (lexer.pos === before) {
      lexer.pos++;
      continue;
    }
    if (!isKeyword(value)) {
      operands.push(value);
      // Operand runs are short; a runaway one means malformed content.
      if (operands.length > 64) operands = operands.slice(-16);
      continue;
    }

    const op = value.op;
    if (op === "Tf") {
      const name = operands[operands.length - 2];
      currentFont = isName(name) ? name.name : undefined;
    } else if (SHOW_TEXT.has(op)) {
      if (currentFont !== undefined && !checkedFonts.has(currentFont)) {
        checkedFonts.add(currentFont);
        await checkFont(doc, fonts?.get(currentFont));
      }
    } else if (op === "Do") {
      const name = operands[operands.length - 1];
      if (isName(name)) {
        const ref = xobjects?.get(name.name);
        await checkXObject(doc, ref, seenForms, depth);
      }
    } else if (op === "BI") {
      // An inline image's binary data is not PDF syntax; skip to `EI` so it
      // cannot be mistaken for operators.
      lexer.pos = skipInlineImage(content, lexer.pos);
    }
    operands = [];
  }
}

/** Refuse a font whose glyphs the file does not carry (PDF-1). */
async function checkFont(doc: PdfDocument, fontRef: PdfValue | undefined): Promise<void> {
  const font = await doc.dict(fontRef);
  if (!font) return; // a missing resource is malformed content, not a font gap

  const subtype = font.get("Subtype");
  // A Type 3 font's glyphs *are* drawing procedures, carried in the file. They
  // count as present: the Ghent PDF/X-4 suite uses them, and treating "no
  // embedded font program" as absence would reject the acceptance corpus.
  // Their artwork is counted as skipped rendering instead (PDF-8).
  if (isName(subtype) && subtype.name === "Type3") return;

  // A composite font carries its descriptor on the descendant, not the parent.
  let descriptorOwner = font;
  const descendants = await doc.array(font.get("DescendantFonts"));
  if (descendants.length > 0) descriptorOwner = (await doc.dict(descendants[0])) ?? font;

  const descriptor = await doc.dict(descriptorOwner.get("FontDescriptor"));
  const embedded =
    descriptor !== undefined &&
    (descriptor.has("FontFile") || descriptor.has("FontFile2") || descriptor.has("FontFile3"));
  if (!embedded) throw pdfError("This PDF needs fonts it doesn't embed");
}

/** Recurse into a form, and refuse content that lives outside this file. */
async function checkXObject(
  doc: PdfDocument,
  ref: PdfValue | undefined,
  seenForms: Set<number>,
  depth: number,
): Promise<void> {
  const object = isRef(ref) ? await doc.getObject(ref.num) : undefined;
  if (!isStream(object)) return;
  assertLocal(object);

  const subtype = object.dict.get("Subtype");
  if (!isName(subtype) || subtype.name !== "Form") return; // images are counted, not read

  if (isRef(ref)) {
    if (seenForms.has(ref.num)) return;
    seenForms.add(ref.num);
  }
  const decoded = await doc.readStream(object);
  if (decoded instanceof Uint8Array)
    await checkContent(
      doc,
      decoded,
      await doc.dict(object.dict.get("Resources")),
      seenForms,
      depth + 1,
    );
}

/**
 * Refuse a stream whose bytes live in another file (PDF-1).
 *
 * `/F` on a stream dictionary means the data is elsewhere; loading would
 * produce a drawing silently missing part of itself.
 */
function assertLocal(stream: PdfStream): void {
  if (stream.dict.has("F") || stream.dict.has("FFilter"))
    throw pdfError("This PDF's content lives in another file");
}

/** Position after an inline image's `EI`, given the position after `BI`. */
function skipInlineImage(content: Uint8Array, from: number): number {
  for (let i = from; i < content.length - 1; i++) {
    if (content[i] !== 0x45 || content[i + 1] !== 0x49) continue; // "EI"
    const after = content[i + 2];
    if (after === undefined || after <= 0x20) return i + 2;
  }
  return content.length;
}
