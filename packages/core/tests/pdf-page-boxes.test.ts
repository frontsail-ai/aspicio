/**
 * Page geometry: the sheet a PDF page is drawn on, and the production guides
 * that live on it (PDF-10, VIEW-17, VIEW-19).
 *
 * Driven from real PDF bytes rather than hand-built documents, because the
 * interesting behaviour is in reading the boxes — inheritance, the crop, the
 * rotate — not in what the model does with them afterwards.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { parsePdfBytes } from "../src/parse/pdf/parse.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

const load = async (name: string) =>
  parsePdfBytes(
    new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/pdf/${name}`, import.meta.url)))),
  );

describe("page boxes", () => {
  it("uses the CropBox, not the MediaBox, as the sheet", async () => {
    const doc = await load("page-boxes.pdf");
    // MediaBox is [0 0 400 300]; the file is imposed on oversized media and
    // declares its finished page in the CropBox. Drawing the media would show
    // paper no reader ever sees.
    expect(doc.page?.sheet).toEqual({ minX: 20, minY: 10, maxX: 220, maxY: 170 });
  });

  it("keeps trim and bleed as distinct boxes", async () => {
    const doc = await load("page-boxes.pdf");
    expect(doc.page?.bleed).toEqual({ minX: 30, minY: 20, maxX: 210, maxY: 160 });
    expect(doc.page?.trim).toEqual({ minX: 40, minY: 30, maxX: 200, maxY: 150 });
  });

  it("clips a CropBox that escapes the media", async () => {
    const doc = await load("page-crop-overflow.pdf");
    // The spec requires the crop to lie within the media; real files disagree.
    // The intersection means no paper is drawn where no media exists.
    expect(doc.page?.sheet).toEqual({ minX: 0, minY: 0, maxX: 150, maxY: 80 });
  });

  it("leaves DXF-shaped documents unbounded", async () => {
    const doc = await load("minimal.pdf");
    // No CropBox: the media is the sheet, and with no Trim/Bleed declared
    // there is nothing to draw guides for.
    expect(doc.page?.sheet).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
    expect(doc.page?.trim).toBeUndefined();
    expect(doc.page?.bleed).toBeUndefined();
  });

  it("frames the page, not the ink on it", async () => {
    const doc = await load("page-boxes.pdf");
    const t = tessellate(doc);
    // The line runs 30,30 → 170,130, well inside the sheet. Bounds must be
    // the sheet's, or a fit would zoom past the paper onto the artwork.
    expect(t.bounds).toEqual({ minX: 20, minY: 10, maxX: 220, maxY: 170 });
  });

  it("puts the backdrop outside `layers`, where picking cannot see it", async () => {
    const doc = await load("page-boxes.pdf");
    const t = tessellate(doc);
    expect(t.backdrop).not.toBeNull();
    // Every layer's geometry is entity geometry: the sheet contributes no
    // segments, no fills and no pickable ids.
    const segments = [...t.layers.values()].reduce((n, l) => n + l.segmentIds.length, 0);
    expect(segments).toBe(t.segmentCount);
  });
});

describe("SVG export parity", () => {
  it("draws the sheet under the content and the guides over it", async () => {
    const { tessellationToSvg } = await import("../src/export.ts");
    const doc = await load("page-boxes.pdf");
    const svg = tessellationToSvg(tessellate(doc), () => true, {
      sheet: "#ffffff",
      guides: true,
    });

    // The sheet is the first thing inside the flipped group, so it is the
    // bottom band here exactly as it is on the canvas.
    const body = svg.slice(svg.indexOf("<g transform="));
    expect(body.indexOf('fill="#ffffff"')).toBeLessThan(body.indexOf("<path"));
    // Both guides present, dashed, and above the content.
    expect(body).toContain('stroke="#e0301e"');
    expect(body).toContain('stroke="#7a7a7a"');
    expect(body.indexOf('stroke="#7a7a7a"')).toBeGreaterThan(body.indexOf("<path"));
  });

  it("omits both when the caller does not ask", async () => {
    const { tessellationToSvg } = await import("../src/export.ts");
    const doc = await load("page-boxes.pdf");
    const svg = tessellationToSvg(tessellate(doc));
    expect(svg).not.toContain("#7a7a7a");
    expect(svg).not.toContain('fill="#ffffff"');
  });
});
