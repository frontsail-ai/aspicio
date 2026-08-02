/**
 * Marked content → layers, end to end (PDF-7).
 *
 * The model is unit-tested next door; this is about the interpreter's stack,
 * where the failure modes are silent: content lands on a plausible-looking
 * wrong layer rather than crashing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { parsePdfBytes } from "../src/parse/pdf/parse.ts";

const parse = async (name: string) =>
  parsePdfBytes(
    new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/pdf/${name}`, import.meta.url)))),
  );

/** Entities on a layer, across model space and every later page. */
const onLayer = (doc: Awaited<ReturnType<typeof parse>>, layer: string): number =>
  doc.entities.filter((e) => e.layer === layer).length +
  (doc.layouts ?? []).reduce((n, l) => n + l.entities.filter((e) => e.layer === layer).length, 0);

// ---------------------------------------------------------------------------
// The trap: EMC closes every mark, not just /OC ones.

test("marked content without /OC does not shift the layer (PDF-7)", async () => {
  const doc = await parse("ocg-non-oc-marks.pdf");

  // Inside the /OC region: one stroke in an /Artifact BMC, one in a /Span BDC,
  // one after both close. All three belong to "Marked". One stroke follows the
  // region's EMC and belongs to "Content".
  //
  // If BMC or a non-/OC BDC fails to push, its EMC closes the /OC mark early
  // and the strokes after it fall to "Content" — which is why the nesting is
  // inside the region rather than beside it.
  expect(onLayer(doc, "Marked")).toBe(3);
  expect(onLayer(doc, "Content")).toBe(1);
});

test("unbalanced marked content draws less, never throws (INV-3)", async () => {
  // A leading EMC with nothing open, and a BDC never closed.
  const doc = await parse("ocg-unbalanced-marks.pdf");
  const total =
    doc.entities.length + (doc.layouts ?? []).reduce((n, l) => n + l.entities.length, 0);
  expect(total).toBe(2);
  // The stroke before the BDC is unmarked; the one after it stays on the
  // layer the unclosed mark opened.
  expect(onLayer(doc, "Content")).toBe(1);
  expect(onLayer(doc, "Never Closed")).toBe(1);
});

// ---------------------------------------------------------------------------
// The rest.

test("content marked with /OC lands on that group's layer", async () => {
  const doc = await parse("ocg-basic.pdf");
  // "Content" is absent: every entity is on a group, so the panel shows only
  // what the file declares.
  expect([...doc.layers.keys()]).toEqual(["Visible Layer", "Hidden Layer"]);
  expect(onLayer(doc, "Visible Layer")).toBe(1);
  expect(onLayer(doc, "Hidden Layer")).toBe(1);
  expect(doc.layers.get("Hidden Layer")?.visible).toBe(false);
});

test("an XObject's own /OC layers its content, and cannot leak (PDF-7)", async () => {
  const doc = await parse("ocg-xobject-oc.pdf");
  // The form draws twice, the second stroke inside a mark it never closes.
  expect(onLayer(doc, "Form Layer")).toBe(2);
  // The parent draws once after the form returns. Without truncating the mark
  // stack at the form boundary, that stroke inherits the form's layer.
  expect(onLayer(doc, "Content")).toBe(1);
});

test("one group carrying content on two pages is one layer (PDF-7)", async () => {
  const doc = await parse("ocg-multipage-shared.pdf");
  // Page 1 is model space, page 2 a layout (PDF-5) — but layer identity is
  // document-wide, so this is one row whose count spans both, not two rows.
  expect([...doc.layers.keys()]).toEqual(["Shared Across Pages"]);
  expect(doc.layers.get("Shared Across Pages")?.entityCount).toBe(3);
  expect(doc.layouts?.length).toBe(1);
  expect(onLayer(doc, "Shared Across Pages")).toBe(3);
});

test("a declared group that draws nothing is still a layer with no entities", async () => {
  const doc = await parse("ocg-unused-group.pdf");
  expect([...doc.layers.keys()]).toContain("Declared Only");
  expect(doc.layers.get("Declared Only")?.entityCount).toBe(0);
  // isEmptyLayer collapses it in every panel — correct reporting (PDF-7).
});

test("two groups sharing a name keep separate layers and separate content", async () => {
  const doc = await parse("ocg-duplicate-names.pdf");
  expect([...doc.layers.keys()]).toEqual(["One", "One (2)"]);
  expect(onLayer(doc, "One")).toBe(1);
  expect(onLayer(doc, "One (2)")).toBe(1);
});

test("a visibility expression leaves its content on Content, counted (PDF-8)", async () => {
  const doc = await parse("ocg-visibility-expression.pdf");
  expect(onLayer(doc, "Content")).toBe(1);
  expect(doc.unsupported["VisibilityExpression"]).toBeGreaterThan(0);
});

test("a PDF with no optional content still loads onto Content alone", async () => {
  const doc = await parse("minimal.pdf");
  expect([...doc.layers.keys()]).toEqual(["Content"]);
});
