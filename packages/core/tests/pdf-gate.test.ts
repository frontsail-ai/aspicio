import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { PdfDocument } from "../src/parse/pdf/document.ts";
import { DrawingParseError } from "../src/parse/errors.ts";
import { checkStrictGate } from "../src/parse/pdf/gate.ts";

/** Fixtures come from `tests/fixtures/pdf/make-fixtures.mjs`. */
const open = async (name: string): Promise<PdfDocument> =>
  await PdfDocument.parse(
    new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/pdf/${name}`, import.meta.url)))),
  );

const gate = async (name: string): Promise<unknown> =>
  await checkStrictGate(await open(name)).then(
    () => null,
    (error: unknown) => error,
  );

/* ---------- the three refusals (PDF-1) ---------- */

test("refuses an encrypted PDF", async () => {
  const error = await gate("encrypted.pdf");
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toBe("Encrypted PDFs are not supported");
  expect((error as DrawingParseError).format).toBe("pdf");
});

test("refuses text drawn in a font the file does not carry", async () => {
  const error = await gate("font-not-embedded.pdf");
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toBe("This PDF needs fonts it doesn't embed");
});

test("refuses content stored in another file", async () => {
  const error = await gate("external-content.pdf");
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toBe("This PDF's content lives in another file");
});

/* ---------- what the gate must NOT refuse ---------- */

// A signature dictionary is not encryption. The Ghent X-4 suite is signed, so
// confusing the two would reject the corpus this phase is built to read.
test("accepts a signed but unencrypted file", async () => {
  expect(await gate("signed-not-encrypted.pdf")).toBeNull();
});

// The gate is a usage check, not a resource audit: a font can be declared and
// even selected without ever drawing text, and that file renders fine.
test("accepts a non-embedded font that never draws text", async () => {
  expect(await gate("font-not-embedded-unused.pdf")).toBeNull();
});

test("accepts an embedded font program", async () => {
  expect(await gate("font-embedded.pdf")).toBeNull();
});

test("accepts a composite font whose program hangs off the descendant", async () => {
  expect(await gate("font-composite-embedded.pdf")).toBeNull();
});

// PDF-1: a Type 3 font's glyphs *are* drawing procedures carried in the file,
// so they count as present. Their artwork is counted as skipped later (PDF-8).
test("accepts a Type 3 font, whose glyphs are drawing procedures", async () => {
  expect(await gate("font-type3.pdf")).toBeNull();
});

test("accepts the plain fixtures with no text at all", async () => {
  expect(await gate("minimal.pdf")).toBeNull();
  expect(await gate("contents-array.pdf")).toBeNull();
  expect(await gate("xref-stream-objstm.pdf")).toBeNull();
});

/* ---------- the gate follows content, not just the page ---------- */

// Most real content lives in form XObjects — the Ghent X-4 file has 269 of
// them against 13 page streams — so a gate that only read pages would miss
// nearly every font actually used.
test("follows forms when checking fonts", async () => {
  const error = await gate("form-font-not-embedded.pdf");
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toBe("This PDF needs fonts it doesn't embed");
});

/* ---------- inheritance gaps found by review probes ---------- */

// A form without its own /Resources uses the invoking context's, so the page's
// non-embedded font is what this text is actually drawn in.
test("follows a form that inherits the page's resources", async () => {
  const error = await gate("form-inherits-resources.pdf");
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toBe("This PDF needs fonts it doesn't embed");
});

// A form inherits the graphics state of whatever invoked it: the font is
// selected on the page and only used inside the form.
test("follows a font selected before the form that draws with it", async () => {
  const error = await gate("form-inherits-font.pdf");
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toBe("This PDF needs fonts it doesn't embed");
});

// PDF-1 says "content stored outside this document" without qualification, so
// a page's own stream counts, not just an XObject's.
test("refuses a page whose own content lives in another file", async () => {
  const error = await gate("external-page-content.pdf");
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toBe("This PDF's content lives in another file");
});
