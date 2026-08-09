/**
 * Optional content against real files (PDF-7).
 *
 * The corpus is nine PDFs collected from the pdf.js test suite — the only
 * source of genuine OCG structure we found, since the Ghent acceptance suite
 * has none. They are **not committed**: their provenance is bug reports with
 * mixed licensing, which a MIT repo should not absorb. They live in gitignored
 * `tmp/ocg-corpus/`, so these tests skip in CI, exactly like the Ghent suite.
 *
 * Every file carries an expected outcome rather than a blanket try/catch:
 *
 * - `layers`   — parses, and these layers appear with these entity counts
 * - `gated`    — legitimately refused by the strict gate (PDF-1)
 *
 * A blanket catch would turn a real regression into a silent pass, which is
 * the failure this suite exists to prevent. And the skip is guarded: it may
 * only fire when the directory is genuinely absent, so a rename cannot
 * quietly disable the whole file.
 *
 * To reproduce the corpus, see the download list in the Phase 2 plan.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { parsePdfBytes } from "../src/parse/pdf/parse.ts";

const DIR = fileURLToPath(new URL("../../../tmp/ocg-corpus/", import.meta.url));
const present = existsSync(DIR);

/* Files whose entities all sit on groups carry no "Content" row: it appears
 * only when it holds unmarked content, or when nothing else does. */
interface Expectation {
  /** Layer name → entity count. A count of 0 means declared but empty. */
  readonly layers?: Record<string, number>;
  /** The file is refused by the strict gate, and this is the reason. */
  readonly gated?: RegExp;
  readonly totalLayers?: number;
}

const CORPUS: Record<string, Expectation> = {
  // Two groups named "One": they must stay separate, with separate content.
  "issue269_1.pdf": { layers: { One: 1, "One (2)": 2, Two: 1 }, totalLayers: 3 },
  // 49 groups behind 1041 membership references — a leak or desync here shows
  // up as content piled onto one layer instead of spread across many.
  "issue269_2.pdf": { layers: { Positions: 64 }, totalLayers: 49 },
  // Named layers with real distribution.
  "issue11144_reduced.pdf": { layers: { Main: 43, "Notes!": 11, "Layer 3": 2 }, totalLayers: 3 },
  // XObject-level /OC on images: declared, drawing nothing, correctly empty.
  "issue17679.pdf": { layers: { red: 3, green: 1 } },
  "issue17679_2.pdf": { layers: { red: 3, green: 1 } },
  // One group across 27 pages, carried by an image XObject. Since images
  // draw (PDF-9) the group holds one entity per page — a single decode
  // placed 27 times (the document-scoped cache) — and five ungrouped images
  // land on Content. Six images stay counted: their codecs are out of scope.
  "issue14824.pdf": { layers: { Content: 11783, Stamp: 27 }, totalLayers: 2 },
  // 35 groups, 3 ordered, 33 hidden by /OFF — all 35 still present.
  "issue12007_reduced.pdf": { totalLayers: 36 },
  // Pure /VE memberships: not evaluated, content stays on Content (PDF-7).
  "visibility_expressions.pdf": { layers: { Content: 10 } },
  // Legitimately refused: pdf.js test files are not curated for embedded
  // fonts. Pinned as gated so a future parse failure cannot hide here.
  "issue15719.pdf": { gated: /needs fonts it doesn't embed/ },
};

test("the corpus directory is either present or genuinely absent", () => {
  // The guard on the skip: if the directory exists, every expected file must
  // too, so a rename cannot silently reduce this suite to nothing.
  if (!present) {
    expect(existsSync(DIR)).toBe(false);
    return;
  }
  for (const name of Object.keys(CORPUS)) {
    expect(existsSync(`${DIR}${name}`), `${name} missing from the corpus`).toBe(true);
  }
});

for (const [name, expected] of Object.entries(CORPUS)) {
  test.skipIf(!present)(`${name}: optional content matches the file (PDF-7)`, async () => {
    const bytes = new Uint8Array(readFileSync(`${DIR}${name}`));

    if (expected.gated) {
      await expect(parsePdfBytes(bytes)).rejects.toThrow(expected.gated);
      return;
    }

    const doc = await parsePdfBytes(bytes);
    if (expected.totalLayers !== undefined) expect(doc.layers.size).toBe(expected.totalLayers);
    for (const [layer, count] of Object.entries(expected.layers ?? {})) {
      expect(doc.layers.get(layer), `${name} has no layer "${layer}"`).toBeDefined();
      expect(doc.layers.get(layer)?.entityCount, `${name} layer "${layer}"`).toBe(count);
    }
  });
}
