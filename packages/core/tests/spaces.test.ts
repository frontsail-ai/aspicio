/**
 * Entity counts are scoped to a space (VIEW-16, INV-13).
 *
 * The property under test is that a layer row and the total beside it are two
 * views of one number. They were not: the DXF parser counted model plus the
 * active paper space, the PDF parser counted every page, and `viewer.stats`
 * counted model space alone — so any drawing with more than one space showed
 * a layer holding more entities than the drawing had (issue #161). On a
 * single-space drawing all three agree, which is why it went unnoticed.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { countEntitiesByLayer } from "../src/layers.ts";
import type { DrawingDocument } from "../src/model/types.ts";
import { parseDxf } from "../src/parse/parse.ts";
import { parsePdfBytes } from "../src/parse/pdf/parse.ts";
import { UnknownSpaceError, documentEntities, spaceEntities, spaceNames } from "../src/spaces.ts";
import { tessellateSpace } from "../src/tessellate/tessellate.ts";

const d = (...pairs: (string | number)[]): string => pairs.join("\n");
const line = (layer: string, paper = false): string =>
  paper
    ? d(0, "LINE", 8, layer, 67, 1, 10, 0, 20, 0, 11, 1, 21, 1)
    : d(0, "LINE", 8, layer, 10, 0, 20, 0, 11, 1, 21, 1);

/* Model space, an active paper layout, and a second layout living in a
 * *Paper_Space block — the three places DXF entities hide. No viewports, so
 * each space draws only its own geometry. */
const THREE_SPACES = d(
  0,
  "SECTION",
  2,
  "BLOCKS",
  0,
  "BLOCK",
  2,
  "*Paper_Space0",
  10,
  0,
  20,
  0,
  line("SHEET2"),
  line("SHEET2"),
  0,
  "ENDBLK",
  0,
  "ENDSEC",
  0,
  "SECTION",
  2,
  "ENTITIES",
  line("MODEL"),
  line("MODEL"),
  line("MODEL"),
  line("SHEET1", true),
  0,
  "ENDSEC",
  0,
  "EOF",
);

const pdf = async (name: string): Promise<DrawingDocument> =>
  parsePdfBytes(
    new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/pdf/${name}`, import.meta.url)))),
  );

/** Every space accounts for exactly its own entities — the property that broke. */
function expectRowsSumToSpace(doc: DrawingDocument): void {
  for (const name of spaceNames(doc)) {
    const counts = tessellateSpace(doc, name).entityCounts;
    let sum = 0;
    for (const n of counts.values()) sum += n;
    expect(sum, `space "${name}" rows sum to its entities`).toBe(spaceEntities(doc, name)!.length);
  }
}

test("countEntitiesByLayer buckets every entity exactly once", () => {
  const doc = parseDxf(THREE_SPACES);
  const counts = countEntitiesByLayer(doc.entities);
  expect(Object.fromEntries(counts)).toEqual({ MODEL: 3 });
  let sum = 0;
  for (const n of counts.values()) sum += n;
  expect(sum).toBe(doc.entities.length);
});

test("a DXF layer count covers the space on screen, not the whole file", () => {
  const doc = parseDxf(THREE_SPACES);
  expect(spaceNames(doc)).toEqual(["Model", "Layout1", "Layout2"]);

  // Parsing seeds model space: the paper-space line is not on this screen.
  expect(doc.layers.get("MODEL")?.entityCount).toBe(3);
  expect(doc.layers.get("SHEET1")?.entityCount).toBe(0);

  // Each sheet reports its own. SHEET2's entities live in a layout block,
  // which the parser used to create a row for and then never count — the
  // layer read 0 while its geometry was on screen, so `isEmptyLayer` filed a
  // drawn layer under "empty".
  expect(Object.fromEntries(tessellateSpace(doc, "Layout1").entityCounts)).toEqual({ SHEET1: 1 });
  expect(Object.fromEntries(tessellateSpace(doc, "Layout2").entityCounts)).toEqual({ SHEET2: 2 });

  expectRowsSumToSpace(doc);
  expect(documentEntities(doc)).toHaveLength(6);
});

/* A sheet with two windows onto the same model space — the case where a naive
 * "count what each viewport draws" would report model geometry twice. */
const viewport = (x: number): string =>
  // prettier-ignore
  d(0, "VIEWPORT", 8, "SHEET", 67, 1, 10, x, 20, 100, 40, 60, 41, 40, 68, 2, 69, 2,
    12, 5, 22, 5, 17, 5, 27, 5, 45, 20, 51, 0);

const SHEET_WITH_VIEWPORTS = d(
  0,
  "SECTION",
  2,
  "ENTITIES",
  line("MODEL"),
  line("MODEL"),
  line("SHEET", true),
  viewport(100),
  viewport(200),
  0,
  "ENDSEC",
  0,
  "EOF",
);

test("a sheet counts the model layers its viewports show, once", () => {
  const doc = parseDxf(SHEET_WITH_VIEWPORTS);
  expect(doc.layouts![0].viewports).toHaveLength(2);

  // Model space: its own entities, nothing on the sheet's layer.
  expect(Object.fromEntries(tessellateSpace(doc).entityCounts)).toEqual({ MODEL: 2 });

  // The sheet draws its own border *and* model geometry through the windows.
  // Reporting MODEL as 0 here would contradict the canvas (INV-2); reporting
  // 4 would double it, once per window, and stop the rows summing to the
  // space's own total.
  expect(Object.fromEntries(tessellateSpace(doc, "Layout1").entityCounts)).toEqual({
    SHEET: 1,
    MODEL: 2,
  });

  // So spaces do not partition a DXF: 2 + 3 exceeds the 3 entities it holds.
  expect(documentEntities(doc)).toHaveLength(3);
  expectRowsSumToSpace(doc);
});

test("every page of a multi-page PDF counts its own entities (PDF-5, PDF-7)", async () => {
  const doc = await pdf("three-pages-varied.pdf");
  expect(spaceNames(doc)).toEqual(["Model", "Page 2", "Page 3"]);
  // One row, spanning the document; the count is what page 1 draws.
  expect([...doc.layers.keys()]).toEqual(["Content"]);
  expect(doc.layers.get("Content")?.entityCount).toBe(1);
  // The fixture draws 1, 2, then 3 lines, so a count carried over from another
  // page cannot pass by coincidence.
  expect(spaceNames(doc).map((n) => tessellateSpace(doc, n).entityCounts.get("Content"))).toEqual([
    1, 2, 3,
  ]);
  // Pages do partition a PDF — nothing is re-shown the way a viewport does.
  expect(documentEntities(doc)).toHaveLength(6);
  expectRowsSumToSpace(doc);
});

test("a group that draws only on a later page is still a row, at zero", async () => {
  const doc = await pdf("ocg-multipage-shared.pdf");
  expect([...doc.layers.keys()]).toEqual(["Shared Across Pages"]);
  expect(doc.layers.get("Shared Across Pages")?.entityCount).toBe(1);
  expect(tessellateSpace(doc, "Page 2").entityCounts.get("Shared Across Pages")).toBe(2);
});

test("tessellateSpace rejects a space the drawing does not have", () => {
  const doc = parseDxf(THREE_SPACES);
  expect(() => tessellateSpace(doc, "Layout9")).toThrow(UnknownSpaceError);
  // The message names what is available, so a caller can correct itself.
  expect(() => tessellateSpace(doc, "Layout9")).toThrow(/"Model", "Layout1", "Layout2"/);
  expect(spaceEntities(doc, "Layout9")).toBeNull();
});
