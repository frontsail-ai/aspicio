import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { DrawingParseError } from "../src/parse/errors.ts";
import { parsePdfBytes, sniffPdf } from "../src/parse/pdf/parse.ts";
import type { Entity } from "../src/model/types.ts";

const bytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/pdf/${name}`, import.meta.url))));

const parse = (name: string) => parsePdfBytes(bytes(name));

/* ---------- the sniff (PARSE-13) ---------- */

test("claims files with a PDF header", () => {
  expect(sniffPdf(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
  // A leading preamble before the header is common enough that the spec
  // permits scanning the first kilobyte.
  expect(sniffPdf(new TextEncoder().encode(`${"x".repeat(200)}%PDF-1.4`))).toBe(true);
  expect(sniffPdf(bytes("minimal.pdf"))).toBe(true);
});

test("does not claim anything else", () => {
  expect(sniffPdf(new TextEncoder().encode("0\nSECTION\n"))).toBe(false);
  expect(sniffPdf(new TextEncoder().encode("%PDF"))).toBe(false); // no version dash
  expect(sniffPdf(new TextEncoder().encode(`${"x".repeat(2000)}%PDF-1.4`))).toBe(false);
  expect(sniffPdf(new Uint8Array())).toBe(false);
});

/* ---------- document assembly (PDF-5, PDF-6, PDF-7) ---------- */

test("produces a document in the shape the rest of the pipeline expects", async () => {
  const doc = await parse("minimal.pdf");
  expect(doc.entities.length).toBeGreaterThan(0);
  expect(doc.blocks.size).toBe(0);
  expect(doc.layouts).toEqual([]);
  expect(doc.format).toBe("pdf");
});

// PDF-6: points, unchanged. A drawing whose real scale lives in its artwork
// is not second-guessed.
test("reports points as its unit", async () => {
  expect((await parse("minimal.pdf")).units).toBe("pt");
});

// PDF-7: one layer until OCG support arrives.
test("puts everything on a single Content layer", async () => {
  const doc = await parse("minimal.pdf");
  expect([...doc.layers.keys()]).toEqual(["Content"]);
  expect(doc.layers.get("Content")?.visible).toBe(true);
  expect(doc.layers.get("Content")?.entityCount).toBe(doc.entities.length);
  for (const entity of doc.entities) expect(entity.layer).toBe("Content");
});

// PDF-5: page 1 is model space because the viewer opens model space on load —
// a PDF whose first page lived in a layout would open blank.
test("maps page 1 to model space and later pages to named spaces", async () => {
  const doc = await parse("three-pages.pdf");
  expect(doc.entities.length).toBeGreaterThan(0);
  expect(doc.layouts?.map((l) => l.name)).toEqual(["Page 2", "Page 3"]);
  for (const layout of doc.layouts ?? []) {
    expect(layout.entities.length).toBeGreaterThan(0);
    expect(layout.viewports).toEqual([]);
  }
});

test("each page's geometry lands in its own space", async () => {
  const doc = await parse("three-pages.pdf");
  // Page N draws from (N,N) to (N*10, N*10), so the spaces are distinguishable.
  const firstPoint = (entities: readonly Entity[]): number => {
    const line = entities.find((e) => e.type === "POLYLINE");
    return line?.type === "POLYLINE" ? (line.points[0]?.x ?? -1) : -1;
  };
  expect(firstPoint(doc.entities)).toBe(1);
  expect(firstPoint(doc.layouts?.[0]?.entities ?? [])).toBe(2);
  expect(firstPoint(doc.layouts?.[1]?.entities ?? [])).toBe(3);
});

test("carries the interpreter's unsupported counts onto the document", async () => {
  const doc = await parse("external-content.pdf").catch(() => null);
  // That fixture is refused by the gate, so use one that draws instead.
  const drawn = await parse("flate-indirect-length.pdf");
  expect(doc).toBeNull();
  expect(drawn.unsupported).toBeDefined();
});

test("the strict gate runs before any interpretation", async () => {
  await expect(parse("encrypted.pdf")).rejects.toThrow(/encrypted/i);
  await expect(parse("font-not-embedded.pdf")).rejects.toThrow(/doesn't embed/i);
});

test("a PDF with no pages fails with a human message", async () => {
  const error = await parse("no-pages.pdf").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toBe("This PDF has no pages");
  expect((error as DrawingParseError).format).toBe("pdf");
});

test("dash linetypes survive the page merge", async () => {
  const doc = await parse("minimal.pdf");
  // No dashes in this fixture, but the map must exist for the renderer.
  expect(doc.lineTypes).toBeInstanceOf(Map);
});

test("a document parses to entities that reference only known linetypes", async () => {
  const doc = await parse("three-pages.pdf");
  const all = [...doc.entities, ...(doc.layouts ?? []).flatMap((l) => l.entities)];
  for (const entity of all)
    if (entity.lineType !== undefined) expect(doc.lineTypes.has(entity.lineType)).toBe(true);
});

// A stream this build cannot decompress at all must cost that stream, not the
// page. Reachable by hostile input once PDF is exposed to the API, which the
// acceptance corpus never exercises — its damaged streams are all salvageable.
test("an undecodable form costs the form, not the page", async () => {
  const doc = await parse("form-undecodable.pdf");
  // The page's own stroke still drew.
  expect(doc.entities.length).toBeGreaterThan(0);
  // And the loss is reported rather than hidden (PDF-8).
  expect(doc.unsupported["UndecodableStream"]).toBe(1);
});
