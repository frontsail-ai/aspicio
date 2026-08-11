/**
 * Raster images against the real prepress suites (PDF-9): the Ghent PDF
 * Output Suite 5.0 test pages and the PDFX-ready Output Test 3.02e — the
 * exact market this feature serves.
 *
 * The files are **not committed**: GWG's license permits use for "testing
 * workflow setup" (our use, verbatim) but not public redistribution, so
 * they live in gitignored `tmp/pdf-samples/`. CI fetches them from a
 * private corpus store; locally they are copied in once. The skip is
 * guarded twice: it may only fire when the directory is genuinely absent,
 * and never when the workflow fetched the corpus (PDF_CORPUS_REQUIRED) — a
 * corpus that silently stopped running would turn this suite into
 * decoration. Forks have no corpus token, so their CI skips rather than
 * fails.
 *
 * Every number is pinned exactly. A decoder regression shows up as a
 * changed count, not a vague "fewer things drew".
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { parsePdfBytes } from "../src/parse/pdf/parse.ts";
import { tessellate, tessellateLayout } from "../src/tessellate/tessellate.ts";
import { tessellationToSvg } from "../src/export.ts";

const DIR = fileURLToPath(new URL("../../../tmp/pdf-samples/", import.meta.url));
const present = existsSync(DIR);

interface Expectation {
  /** IMAGE entities per space: [model, ...layouts]. */
  readonly imagesPerSpace: number[];
  /** Total entities across all spaces. */
  readonly totalEntities: number;
  /** Images still counted (JPX, JBIG2, CCITT — outside PDF-9's set). */
  readonly skippedImages: number;
}

const CORPUS: Record<string, Expectation> = {
  // 92 image XObjects; 55 draw (Flate + baseline JPEG in every colour
  // space), 18 uses stay counted: JPX ×2, JBIG2 ×2, CCITT ×1, and the
  // patches that reuse them.
  "Ghent_PDF-Output-Test-V50_ALL_X4.pdf": {
    imagesPerSpace: [12, 6, 10, 7, 10, 10],
    // 6020 before clipping was applied (PDF-3). The 21 fewer are 30 text
    // runs the file draws outside their region, less 9 more polylines from
    // strokes a region cuts into several runs. No image or fill is lost:
    // every clipped placement here crops rather than disappears.
    totalEntities: 5999,
    skippedImages: 18,
  },
  "PDFX-ready_Output-Test_302e_X4.pdf": {
    imagesPerSpace: [12, 6, 10, 6],
    // 6831 before clipping. This file's test pages label panels with text
    // that sits outside the panel's own clip — 377 such runs — and gains 9
    // polylines the same way as above.
    totalEntities: 6463,
    skippedImages: 16,
  },
};

test("the corpus is present, or genuinely absent — and never absent in CI", () => {
  if (process.env.PDF_CORPUS_REQUIRED) {
    expect(present, "the workflow fetched the corpus, yet tmp/pdf-samples is missing").toBe(true);
  }
  if (!present) return;
  for (const name of Object.keys(CORPUS)) {
    expect(existsSync(`${DIR}${name}`), `${name} missing from tmp/pdf-samples`).toBe(true);
  }
});

for (const [name, expected] of Object.entries(CORPUS)) {
  test.skipIf(!present)(`${name}: images decode and draw (PDF-9)`, async () => {
    const doc = await parsePdfBytes(new Uint8Array(readFileSync(`${DIR}${name}`)));

    const spaces = [doc.entities, ...(doc.layouts ?? []).map((l) => l.entities)];
    expect(spaces.map((e) => e.filter((x) => x.type === "IMAGE").length)).toEqual(
      expected.imagesPerSpace,
    );
    expect(spaces.reduce((n, e) => n + e.length, 0)).toBe(expected.totalEntities);
    expect(doc.unsupported["Image"] ?? 0).toBe(expected.skippedImages);

    // Every page tessellates with its images placed, and the SVG embeds
    // exactly that many PNGs — the full headless surface, not just parse.
    for (const [index, count] of expected.imagesPerSpace.entries()) {
      const tess =
        index === 0 ? tessellate(doc) : tessellateLayout(doc, (doc.layouts ?? [])[index - 1]);
      expect(tess.imageCount, `space ${index}`).toBe(count);
      const svg = tessellationToSvg(tess);
      expect(svg.split("<image ").length - 1, `space ${index} svg`).toBe(count);
    }
  });
}
