import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { PdfDocument } from "../src/parse/pdf/document.ts";
import { IDENTITY, interpretContent } from "../src/parse/pdf/interpret.ts";
import type { Matrix } from "../src/parse/pdf/interpret.ts";
import { glyphNameToText, parseToUnicode } from "../src/parse/pdf/text.ts";
import type { TextEntity } from "../src/model/types.ts";

const encode = (s: string) => new TextEncoder().encode(s);

async function run(content: string, ctm: Matrix = IDENTITY) {
  const doc = await PdfDocument.parse(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./fixtures/pdf/inherited-attrs.pdf", import.meta.url))),
    ),
  );
  const [page] = await doc.pages();
  const resources = await doc.dict(page?.get("Resources"));
  return await interpretContent(doc, encode(content), resources, {}, ctm);
}

const texts = (entities: readonly { type: string }[]): TextEntity[] =>
  entities.filter((e): e is TextEntity => e.type === "TEXT");

/* ---------- ToUnicode CMaps ---------- */

test("parses bfchar mappings", () => {
  const map = parseToUnicode(
    encode(`/CIDInit /ProcSet findresource begin
1 begincodespacerange <00> <FF> endcodespacerange
2 beginbfchar
<41> <0041>
<42> <00420043>
endbfchar
end`),
  );
  expect(map.get(0x41)).toBe("A");
  expect(map.get(0x42)).toBe("BC"); // a ligature maps to several characters
});

test("parses bfrange with an incrementing destination", () => {
  const map = parseToUnicode(encode("1 beginbfrange\n<20> <22> <0061>\nendbfrange"));
  expect(map.get(0x20)).toBe("a");
  expect(map.get(0x21)).toBe("b");
  expect(map.get(0x22)).toBe("c");
  expect(map.get(0x23)).toBeUndefined();
});

test("parses bfrange with an explicit array destination", () => {
  const map = parseToUnicode(
    encode("1 beginbfrange\n<10> <12> [<0058> <0059> <005A>]\nendbfrange"),
  );
  expect(map.get(0x10)).toBe("X");
  expect(map.get(0x11)).toBe("Y");
  expect(map.get(0x12)).toBe("Z");
});

test("parses two-byte source codes", () => {
  const map = parseToUnicode(encode("1 beginbfchar\n<0041> <2660>\nendbfchar"));
  expect(map.get(0x0041)).toBe("♠");
});

test("a corrupt range cannot claim an unbounded number of codes", () => {
  const map = parseToUnicode(encode("1 beginbfrange\n<0000> <FFFFFF> <0041>\nendbfrange"));
  expect(map.size).toBeLessThanOrEqual(0x10000);
});

test("malformed CMap data yields an empty map instead of throwing", () => {
  expect(parseToUnicode(encode("garbage ( unterminated")).size).toBe(0);
  expect(parseToUnicode(new Uint8Array()).size).toBe(0);
});

/* ---------- glyph names ---------- */

test("resolves glyph names, including the uniXXXX convention", () => {
  expect(glyphNameToText("space")).toBe(" ");
  expect(glyphNameToText("A")).toBe("A");
  expect(glyphNameToText("quoteright")).toBe("’");
  expect(glyphNameToText("uni20AC")).toBe("€");
  expect(glyphNameToText("u0041")).toBe("A");
  // A subset name carries no character meaning; inventing one would be worse
  // than dropping it.
  expect(glyphNameToText("g34")).toBe("");
});

/* ---------- text emission (PDF-4) ---------- */

test("Tj emits a text entity positioned by the text matrix", async () => {
  const { entities } = await run("BT /F1 12 Tf 100 200 Td (Hello) Tj ET");
  const [text] = texts(entities);
  expect(text?.text).toBe("Hello");
  expect(text?.position).toEqual({ x: 100, y: 200 });
  expect(text?.layer).toBe("Content");
});

test("Tm sets position, size, and rotation together", async () => {
  // A 90° rotation: [0 1 -1 0 tx ty].
  const { entities } = await run("BT /F1 1 Tf 0 12 -12 0 50 60 Tm (X) Tj ET");
  const [text] = texts(entities);
  expect(text?.position).toEqual({ x: 50, y: 60 });
  expect(text?.rotation).toBeCloseTo(Math.PI / 2, 6);
  expect(text?.height).toBeCloseTo(12 * 0.7, 6);
});

test("text height follows the font size and the matrix scale", async () => {
  const plain = await run("BT /F1 10 Tf 0 0 Td (A) Tj ET");
  const scaled = await run("BT /F1 10 Tf 0 0 Td (A) Tj ET", [2, 0, 0, 2, 0, 0]);
  const h1 = texts(plain.entities)[0]?.height ?? 0;
  const h2 = texts(scaled.entities)[0]?.height ?? 0;
  expect(h2).toBeCloseTo(h1 * 2, 6);
});

test("TJ concatenates its string pieces and honours kerning shifts", async () => {
  const { entities } = await run("BT /F1 12 Tf 0 0 Td [(A) -500 (B)] TJ ET");
  const runs = texts(entities);
  expect(runs.map((t) => t.text)).toEqual(["A", "B"]);
  // The kern moves B to the right of A rather than stacking them.
  expect(runs[1]?.position.x ?? 0).toBeGreaterThan(runs[0]?.position.x ?? 0);
});

test("successive runs advance rather than overprinting", async () => {
  const { entities } = await run("BT /F1 12 Tf 0 0 Td (AA) Tj (BB) Tj ET");
  const runs = texts(entities);
  expect(runs).toHaveLength(2);
  expect(runs[1]?.position.x ?? 0).toBeGreaterThan(runs[0]?.position.x ?? 0);
});

test("' starts a new line before showing text", async () => {
  const { entities } = await run("BT /F1 12 Tf 14 TL 0 100 Td (first) Tj (second) ' ET");
  const runs = texts(entities);
  expect(runs).toHaveLength(2);
  // The second run drops by the leading.
  expect(runs[1]?.position.y).toBeCloseTo((runs[0]?.position.y ?? 0) - 14, 6);
});

test("T* moves down by the leading", async () => {
  const { entities } = await run("BT /F1 12 Tf 20 TL 0 500 Td (a) Tj T* (b) Tj ET");
  const runs = texts(entities);
  expect(runs[1]?.position.y).toBeCloseTo(480, 6);
});

test("TD sets the leading as a side effect", async () => {
  const { entities } = await run("BT /F1 12 Tf 0 100 Td 0 -15 TD (a) Tj T* (b) Tj ET");
  const runs = texts(entities);
  expect(runs[0]?.position.y).toBeCloseTo(85, 6);
  expect(runs[1]?.position.y).toBeCloseTo(70, 6);
});

test("text uses the fill colour", async () => {
  const { entities } = await run("BT 1 0 0 rg /F1 12 Tf 0 0 Td (red) Tj ET");
  expect(texts(entities)[0]?.color).toBe(0xff0000);
});

test("BT resets the text matrix, so runs do not accumulate across objects", async () => {
  const { entities } = await run("BT /F1 12 Tf 100 100 Td (a) Tj ET BT /F1 12 Tf 5 5 Td (b) Tj ET");
  const runs = texts(entities);
  expect(runs[1]?.position).toEqual({ x: 5, y: 5 });
});

test("an empty string emits nothing", async () => {
  const { entities } = await run("BT /F1 12 Tf 0 0 Td () Tj ET");
  expect(texts(entities)).toHaveLength(0);
});

test("text with no font selected emits nothing rather than guessing", async () => {
  const { entities } = await run("BT 0 0 Td (orphan) Tj ET");
  expect(texts(entities)).toHaveLength(0);
});

test("zero font size emits nothing", async () => {
  const { entities } = await run("BT /F1 0 Tf 0 0 Td (invisible) Tj ET");
  expect(texts(entities)).toHaveLength(0);
});

test("text state survives q/Q like the rest of the graphics state", async () => {
  const { entities } = await run(
    "BT /F1 12 Tf q /F1 30 Tf 0 0 Td (big) Tj Q 0 50 Td (small) Tj ET",
  );
  const runs = texts(entities);
  expect(runs[0]?.height ?? 0).toBeGreaterThan(runs[1]?.height ?? 0);
});

test("malformed text operators degrade instead of throwing", async () => {
  await expect(run("BT (no font) Tj ET")).resolves.toBeDefined();
  await expect(run("BT /F1 Tf Tj ET")).resolves.toBeDefined();
  await expect(run("ET ET BT BT (x) Tj")).resolves.toBeDefined();
});
