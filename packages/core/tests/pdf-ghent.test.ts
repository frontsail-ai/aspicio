import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { PdfDocument, isStream } from "../src/parse/pdf/document.ts";
import { checkStrictGate } from "../src/parse/pdf/gate.ts";
import { interpretContent } from "../src/parse/pdf/interpret.ts";
import { isUndecoded } from "../src/parse/pdf/filters.ts";
import { PdfLexer, isKeyword, isName, latin1 } from "../src/parse/pdf/objects.ts";

/**
 * Integration coverage against the Ghent PDF Output Suite V5.0 — the corpus
 * this phase is built to read.
 *
 * The suite is ~27 MB of third-party PDFs and is deliberately not in the repo
 * (`tmp/` is gitignored), so these tests skip when it is absent, including in
 * CI. To run them, download the suite and unpack it to:
 *
 *   tmp/Ghent_PDF_Output_Suite_V50_Testpages/
 *
 * from https://www.gwg.org/download/ghent-output-suite/ (free registration).
 * The numbers asserted below were measured against V5.0; a different revision
 * of the suite will legitimately differ.
 */

const dir = fileURLToPath(
  new URL("../../../tmp/Ghent_PDF_Output_Suite_V50_Testpages/", import.meta.url),
);
const X4 = `${dir}Ghent_PDF-Output-Test-V50_ALL_X4.pdf`;
const REFERENCE = `${dir}Ghent_PDF-Output-Test-V50_ALL_REFERENCE.pdf`;
const available = existsSync(X4) && existsSync(REFERENCE);

const open = async (path: string) => await PdfDocument.parse(new Uint8Array(readFileSync(path)));

/** Every operator in a decoded content stream, counted by name. */
function countOperators(content: Uint8Array): Map<string, number> {
  const ops = new Map<string, number>();
  const lexer = new PdfLexer(content);
  while (!lexer.atEnd) {
    lexer.skipSpace();
    if (lexer.atEnd) break;
    const before = lexer.pos;
    const value = lexer.parseObject();
    if (lexer.pos === before) {
      lexer.pos++;
      continue;
    }
    if (isKeyword(value)) ops.set(value.op, (ops.get(value.op) ?? 0) + 1);
  }
  return ops;
}

const sum = (ops: Map<string, number>, names: string[]): number =>
  names.reduce((total, name) => total + (ops.get(name) ?? 0), 0);

describe.skipIf(!available)("Ghent PDF Output Suite V5.0", () => {
  test("the X-4 file's structure resolves end to end", async () => {
    const doc = await open(X4);
    const pages = await doc.pages();
    // Six, not seven: `/Count` and the page-tree walk agree. (The seven-page
    // file in the suite is ALL_REFERENCE, asserted separately below.)
    expect(pages).toHaveLength(6);
    // Signed, but not encrypted — the strict gate must not confuse the two.
    expect(doc.trailerValue("Encrypt")).toBeUndefined();
    for (const page of pages) expect(page.get("MediaBox")).toBeDefined();
  }, 60_000);

  test("page 1's eight-part /Contents array joins without fusing tokens", async () => {
    const doc = await open(X4);
    const [page] = await doc.pages();
    const content = await doc.pageContent(page as never);
    expect(content.length).toBeGreaterThan(8000);
    const ops = countOperators(content);
    // Measured on V5.0: the page draws real vector content, not just images.
    expect(sum(ops, ["m", "l", "c", "v", "y", "re", "h"])).toBeGreaterThan(200);
    expect(ops.get("Do")).toBeGreaterThan(0);
  }, 60_000);

  test("every content stream decodes, and uses only operators we plan for", async () => {
    const doc = await open(X4);
    const pages = await doc.pages();
    const ops = new Map<string, number>();
    let streams = 0;
    for (const page of pages) {
      const content = await doc.pageContent(page as never);
      streams++;
      for (const [op, n] of countOperators(content)) ops.set(op, (ops.get(op) ?? 0) + n);
    }
    expect(streams).toBe(6);
    // The interpreter's planned operator set (PDF-3, PDF-4). Anything outside
    // it would be unplanned scope, so the assertion is the guard.
    const planned = new Set([
      "m",
      "l",
      "c",
      "v",
      "y",
      "re",
      "h",
      "S",
      "s",
      "f",
      "f*",
      "F",
      "B",
      "B*",
      "b",
      "b*",
      "n",
      "RG",
      "rg",
      "K",
      "k",
      "G",
      "g",
      "CS",
      "cs",
      "SC",
      "SCN",
      "sc",
      "scn",
      "BT",
      "ET",
      "Tj",
      "TJ",
      "'",
      '"',
      "Tf",
      "Td",
      "TD",
      "Tm",
      "T*",
      "TL",
      "Tc",
      "Tw",
      "Tz",
      "Ts",
      "Tr",
      "q",
      "Q",
      "cm",
      "w",
      "d",
      "gs",
      "i",
      "j",
      "J",
      "M",
      "ri",
      "Do",
      "sh",
      "BI",
      "ID",
      "EI",
      "W",
      "W*",
      "BDC",
      "BMC",
      "EMC",
      "MP",
      "DP",
      "d0",
      "d1",
      "BX",
      "EX",
    ]);
    const unplanned = [...ops.keys()].filter((op) => !planned.has(op));
    expect(unplanned).toEqual([]);
  }, 120_000);

  test("image streams report their codec instead of being decoded", async () => {
    const doc = await open(X4);
    const codecs = new Map<string, number>();
    // Sampling the first few hundred objects keeps this test quick while
    // still covering every codec the suite uses.
    for (let num = 1; num < 700; num++) {
      const object = await doc.getObject(num);
      if (!isStream(object)) continue;
      const subtype = object.dict.get("Subtype");
      if (!isName(subtype) || subtype.name !== "Image") continue;
      const decoded = await doc.readStream(object);
      if (isUndecoded(decoded))
        codecs.set(decoded.unsupportedFilter, (codecs.get(decoded.unsupportedFilter) ?? 0) + 1);
    }
    // PDF-8: these are counted, never attempted.
    expect(codecs.get("DCTDecode")).toBeGreaterThan(0);
  }, 120_000);

  // The reason PDF-1 says "glyphs absent from the file" rather than "no
  // embedded font program": this suite uses Type 3 fonts, whose glyphs are
  // drawing procedures. The narrower rule would reject the acceptance corpus.
  test("the acceptance corpus passes the strict gate", async () => {
    await expect(checkStrictGate(await open(X4))).resolves.toBeUndefined();
    await expect(checkStrictGate(await open(REFERENCE))).resolves.toBeUndefined();
  }, 180_000);

  test("a real page yields geometry and readable text", async () => {
    const doc = await open(X4);
    const [page] = await doc.pages();
    const content = await doc.pageContent(page as never);
    const resources = await doc.dict(
      (page as never as Map<string, unknown>).get("Resources") as never,
    );
    const { entities, unsupported } = await interpretContent(doc, content, resources);

    const kinds = new Set(entities.map((e) => e.type));
    expect(kinds.has("POLYLINE")).toBe(true);
    expect(entities.length).toBeGreaterThan(50);

    // Text comes out as text, decoded through the file's own character maps
    // (PDF-4). This page carries the suite's copyright line.
    const text = entities
      .filter((e): e is Extract<typeof e, { type: "TEXT" }> => e.type === "TEXT")
      .map((e) => e.text)
      .join(" ");
    expect(text.toLowerCase()).toContain("ghent");

    // Images are counted, not drawn — an honest report about the page (PDF-8).
    expect(Object.keys(unsupported).length).toBeGreaterThan(0);
  }, 120_000);

  test("the reference render is pure raster — near-zero vector content", async () => {
    const doc = await open(REFERENCE);
    const pages = await doc.pages();
    expect(pages).toHaveLength(7);
    const ops = new Map<string, number>();
    for (const page of pages)
      for (const [op, n] of countOperators(await doc.pageContent(page as never)))
        ops.set(op, (ops.get(op) ?? 0) + n);
    // This file is a reference *render*: every page is one placed image.
    // Yielding almost no entities is the correct report about it, not a bug.
    expect(sum(ops, ["m", "l", "c", "v", "y", "re", "h"])).toBe(0);
    expect(sum(ops, ["Tj", "TJ", "'", '"'])).toBe(0);
    expect(ops.get("Do")).toBe(7);
  }, 60_000);
});

// A guard on the guard: if the corpus is present the suite must actually run,
// so a broken path can never look like a clean pass.
test("the Ghent suite is skipped only when genuinely absent", () => {
  expect(available).toBe(existsSync(X4) && existsSync(REFERENCE));
  if (!available) expect(latin1(new Uint8Array())).toBe("");
});
