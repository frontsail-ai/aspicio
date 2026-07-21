/**
 * Regression suite over the vendored jscad/sample-files DXF corpus
 * (tests/fixtures/jscad). Each sample runs the full headless pipeline —
 * parse → tessellate → SVG (PARSE-1..10, VIEW-12) — and is pinned to the
 * geometry it produced when the corpus was verified render-by-render.
 * A drift in any number is a conscious behavior change, not noise.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { parseDxfBytes } from "../src/parse/parse.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";
import { tessellationToSvg } from "../src/export.ts";

const DIR = join(import.meta.dirname, "fixtures", "jscad");

interface Expected {
  entities: number;
  layers: number;
  segments: number;
  fillTriangles: number;
  unsupported?: Record<string, number>;
}

const EXPECTED: Record<string, Expected> = {
  "accumulatortest.dxf": { entities: 2, layers: 1, segments: 148, fillTriangles: 0 },
  "blocks1.dxf": { entities: 2, layers: 1, segments: 152, fillTriangles: 0 },
  // Carries `$XCLIPFRAME 290 2` — parses only via the lenient boolean
  // retry (PARSE-11).
  "blocks2.dxf": { entities: 4, layers: 4, segments: 345, fillTriangles: 0 },
  "circlesellipsesarcs.dxf": { entities: 5, layers: 1, segments: 238, fillTriangles: 0 },
  "closedlwpolylinebug.dxf": { entities: 1, layers: 1, segments: 3, fillTriangles: 0 },
  "dimensions.dxf": { entities: 7, layers: 1, segments: 290, fillTriangles: 3 },
  "ellipticalarcs.dxf": { entities: 9, layers: 1, segments: 363, fillTriangles: 0 },
  "ellipticalarcs2.dxf": { entities: 4, layers: 1, segments: 180, fillTriangles: 0 },
  "empty.dxf": { entities: 0, layers: 4, segments: 0, fillTriangles: 0 },
  "entities.dxf": { entities: 116, layers: 4, segments: 10378, fillTriangles: 120 },
  "floorplan.dxf": {
    entities: 961,
    layers: 24,
    segments: 21104,
    fillTriangles: 0,
    unsupported: { ATTDEF: 2 },
  },
  // Pattern hatch falls back to its boundary outline (PARSE-3).
  "hatches.dxf": { entities: 5, layers: 1, segments: 12, fillTriangles: 0 },
  "layers.dxf": { entities: 9, layers: 3, segments: 80, fillTriangles: 0 },
  "lines.dxf": { entities: 11, layers: 1, segments: 11, fillTriangles: 0 },
  "lwpolylines.dxf": { entities: 2, layers: 1, segments: 10, fillTriangles: 0 },
  "openscad_export.dxf": { entities: 452, layers: 1, segments: 452, fillTriangles: 0 },
  "points.dxf": { entities: 2, layers: 1, segments: 4, fillTriangles: 0 },
  "polylines.dxf": { entities: 2, layers: 2, segments: 16, fillTriangles: 0 },
  "rectangle.dxf": { entities: 1, layers: 2, segments: 4, fillTriangles: 0 },
  "splineA.dxf": { entities: 1, layers: 1, segments: 72, fillTriangles: 0 },
  "splines.dxf": { entities: 2, layers: 1, segments: 144, fillTriangles: 0 },
  "squareandcircle.dxf": { entities: 2, layers: 3, segments: 76, fillTriangles: 0 },
  "texts.dxf": { entities: 2, layers: 1, segments: 126, fillTriangles: 0 },
};

const files = readdirSync(DIR).filter((f) => f.endsWith(".dxf"));

test("the corpus and the expectation table cover the same files", () => {
  expect(files.sort()).toEqual(Object.keys(EXPECTED).sort());
});

describe.each(files)("%s", (file) => {
  const expected = EXPECTED[file];

  test("parses and tessellates to the pinned geometry", () => {
    const doc = parseDxfBytes(new Uint8Array(readFileSync(join(DIR, file))));
    expect(doc.entities.length).toBe(expected.entities);
    expect(doc.layers.size).toBe(expected.layers);
    expect(doc.unsupported).toEqual(expected.unsupported ?? {});

    const tess = tessellate(doc);
    expect(tess.segmentCount).toBe(expected.segments);
    let fillTriangles = 0;
    for (const layer of tess.layers.values()) fillTriangles += layer.fillPositions.length / 9;
    expect(fillTriangles).toBe(expected.fillTriangles);
  });

  test("exports a well-formed, non-degenerate SVG", () => {
    const doc = parseDxfBytes(new Uint8Array(readFileSync(join(DIR, file))));
    const svg = tessellationToSvg(tessellate(doc));
    expect(svg).toContain("viewBox=");
    expect(svg).not.toContain("NaN");
    const [, w, h] = svg.match(/width="([\d.]+)" height="([\d.]+)"/) ?? [];
    expect(Number(w)).toBeGreaterThan(0);
    expect(Number(h)).toBeGreaterThan(0);
  });
});
