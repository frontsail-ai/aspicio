/**
 * The optional-content model (PDF-7), tested as logic.
 *
 * This layer has no visible output, so "it works" cannot be judged by looking
 * at a render. Every clause of PDF-7 gets an assertion that fails when the
 * behaviour is removed — the base-state conditional especially, whose failure
 * mode is a document rendering inverted with nothing counted.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { PdfDocument } from "../src/parse/pdf/document.ts";
import {
  OC_MEMBERSHIP,
  OC_PRINT_DIFFERS,
  OC_VISIBILITY_EXPRESSION,
  readOptionalContent,
} from "../src/parse/pdf/optional-content.ts";
import type { PdfDict, PdfValue } from "../src/parse/pdf/objects.ts";

const load = async (name: string) => {
  const bytes = new Uint8Array(
    readFileSync(fileURLToPath(new URL(`./fixtures/pdf/${name}`, import.meta.url))),
  );
  const doc = await PdfDocument.parse(bytes);
  // The catalog is the object the trailer's /Root points at; every fixture
  // here numbers it 1, and the object layer is what the model reads through.
  const catalog = (await doc.dict({ num: 1, gen: 0 })) as PdfDict | undefined;
  return { doc, catalog };
};

const ref = (num: number): PdfValue => ({ num, gen: 0 });

// ---------------------------------------------------------------------------
// The two failure modes with no real-world example to catch them.

test("a /BaseState /OFF document is not rendered fully visible (PDF-7)", async () => {
  const { doc, catalog } = await load("ocg-basestate-off.pdf");
  const oc = await readOptionalContent(doc, catalog);

  // With base state off, /ON lists what shows and everything else hides.
  // Reading only /OFF — which works on every real file we have — would make
  // both of these visible, silently and uncounted.
  expect(oc.layers.map((l) => [l.name, l.visible])).toEqual([
    ["Shown By ON", true],
    ["Hidden By Base", false],
  ]);
});

test("a group absent from /Order still appears, in /OCGs order (PDF-7)", async () => {
  const { doc, catalog } = await load("ocg-partial-order.pdf");
  const oc = await readOptionalContent(doc, catalog);

  // /Order names only "Ordered"; the other two are declared but unordered.
  // Building the panel from /Order alone would drop them — the real-world
  // shape of this is a file with 35 groups that orders 3.
  expect(oc.layers.map((l) => l.name)).toEqual(["Ordered", "First", "Second"]);
});

// ---------------------------------------------------------------------------
// The rest of PDF-7, clause by clause.

test("groups become layers, and /OFF hides under the default base state", async () => {
  const { doc, catalog } = await load("ocg-basic.pdf");
  const oc = await readOptionalContent(doc, catalog);
  expect(oc.isEmpty).toBe(false);
  expect(oc.layers.map((l) => [l.name, l.visible])).toEqual([
    ["Visible Layer", true],
    ["Hidden Layer", false],
  ]);
});

test("a reference to a group resolves to that group's layer", async () => {
  const { doc, catalog } = await load("ocg-basic.pdf");
  const oc = await readOptionalContent(doc, catalog);
  const resolved = await oc.resolve(ref(5));
  expect(resolved?.layerKey).toBe("5R");
  expect(oc.nameOf(resolved!.layerKey!)).toBe("Visible Layer");
  expect(resolved?.counted).toBeUndefined();
});

test("a membership over several groups uses the first and counts it (PDF-8)", async () => {
  const { doc, catalog } = await load("ocg-ocmd-multi.pdf");
  const oc = await readOptionalContent(doc, catalog);
  const resolved = await oc.resolve(ref(8));
  expect(oc.nameOf(resolved!.layerKey!)).toBe("Alpha");
  expect(resolved?.counted).toBe(OC_MEMBERSHIP);
});

test("a membership naming no known group is counted, not silently dropped", async () => {
  const { doc, catalog } = await load("ocg-ocmd-empty.pdf");
  const oc = await readOptionalContent(doc, catalog);
  const resolved = await oc.resolve(ref(8));
  // There is no layer to place this content on. Leaving it uncounted would
  // make marked content vanish into "Content" with no record — found by
  // mutating the branch away and watching every test still pass.
  expect(resolved?.layerKey).toBeUndefined();
  expect(resolved?.counted).toBe(OC_MEMBERSHIP);
});

test("a visibility expression is not evaluated; its content stays unlayered", async () => {
  const { doc, catalog } = await load("ocg-visibility-expression.pdf");
  const oc = await readOptionalContent(doc, catalog);
  const resolved = await oc.resolve(ref(8));
  expect(resolved?.layerKey).toBeUndefined();
  expect(resolved?.counted).toBe(OC_VISIBILITY_EXPRESSION);
});

test("two groups sharing a name stay two layers (PDF-7)", async () => {
  const { doc, catalog } = await load("ocg-duplicate-names.pdf");
  const oc = await readOptionalContent(doc, catalog);
  // A document's layers are keyed by name, so without a suffix these two
  // distinct groups merge: one row where the file declares two, and one
  // toggle hiding both. A real corpus file (issue269_1) does exactly this.
  expect(oc.layers.map((l) => l.name)).toEqual(["One", "One (2)"]);
  expect(new Set(oc.layers.map((l) => l.key)).size).toBe(2);
});

test("a group declared but never referenced is still a layer (PDF-7)", async () => {
  const { doc, catalog } = await load("ocg-unused-group.pdf");
  const oc = await readOptionalContent(doc, catalog);
  // It has no content, so it will carry entityCount 0 and isEmptyLayer will
  // collapse it in every panel — correct reporting, not a stray row.
  expect(oc.layers.map((l) => l.name)).toEqual(["Drawn", "Declared Only"]);
});

test("print visibility differing from the screen state used is counted (PDF-8)", async () => {
  const { doc, catalog } = await load("ocg-print-differs.pdf");
  const unsupported: Record<string, number> = {};
  const oc = await readOptionalContent(doc, catalog, unsupported);
  // Screen wins — Aspicio is a viewer — and the divergence is reported.
  expect(oc.layers[0]?.visible).toBe(true);
  expect(unsupported[OC_PRINT_DIFFERS]).toBe(1);
});

test("a file with no /OCProperties yields an empty model, not an error", async () => {
  const { doc, catalog } = await load("minimal.pdf");
  const oc = await readOptionalContent(doc, catalog);
  expect(oc.isEmpty).toBe(true);
  expect(await oc.resolve(ref(5))).toBeUndefined();
});

test("an unmarked reference resolves to nothing and counts nothing", async () => {
  const { doc, catalog } = await load("ocg-basic.pdf");
  const oc = await readOptionalContent(doc, catalog);
  // Object 4 is the content stream: a real reference, but not optional content.
  expect(await oc.resolve(ref(4))).toBeUndefined();
});
