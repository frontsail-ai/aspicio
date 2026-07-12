import { expect, test } from "vite-plus/test";
import { clampedKnots, sampleSpline } from "../src/geom/spline.ts";
import type { DxfDocument, Entity, Point2 } from "../src/model/types.ts";
import { parseDxf } from "../src/parse/parse.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

const cp: Point2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 3 },
  { x: 3, y: 3 },
  { x: 4, y: 0 },
];

test("clampedKnots has the right length and clamping", () => {
  const k = clampedKnots(4, 3);
  expect(k).toEqual([0, 0, 0, 0, 1, 1, 1, 1]); // length = 4 + 3 + 1
});

test("a clamped spline passes through its first and last control points", () => {
  const pts = sampleSpline(cp, [], 3, 20);
  expect(pts).toHaveLength(21);
  expect(pts[0]).toEqual({ x: 0, y: 0 });
  expect(pts.at(-1)).toEqual({ x: 4, y: 0 });
});

test("explicit valid knots are honored; malformed ones are regenerated", () => {
  const withKnots = sampleSpline(cp, [0, 0, 0, 0, 1, 1, 1, 1], 3, 10);
  expect(withKnots[0]).toEqual({ x: 0, y: 0 });
  const badKnots = sampleSpline(cp, [1, 2, 3], 3, 10); // wrong length → regenerate
  expect(badKnots[0]).toEqual({ x: 0, y: 0 });
  expect(badKnots.at(-1)).toEqual({ x: 4, y: 0 });
});

test("degree is clamped to at most numControl - 1", () => {
  const pts = sampleSpline(
    [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ],
    [],
    5,
    8,
  );
  expect(pts[0]).toEqual({ x: 0, y: 0 });
  expect(pts.at(-1)).toEqual({ x: 2, y: 2 });
});

test("the curve bows toward the interior control points", () => {
  const pts = sampleSpline(cp, [], 3, 40);
  const maxY = Math.max(...pts.map((p) => p.y));
  expect(maxY).toBeGreaterThan(0);
  expect(maxY).toBeLessThan(3); // stays inside the control polygon
});

/* ---------- through the pipeline ---------- */

function splineDoc(entities: Entity[]): DxfDocument {
  return {
    layers: new Map([
      ["0", { name: "0", color: 0xffffff, visible: true, frozen: false, entityCount: 0 }],
    ]),
    entities,
    blocks: new Map(),
    lineTypes: new Map(),
    unsupported: {},
  };
}

test("SPLINE tessellates to a sampled polyline", () => {
  const tess = tessellate(
    splineDoc([
      {
        type: "SPLINE",
        layer: "0",
        color: null,
        controlPoints: cp,
        knots: [],
        degree: 3,
        closed: false,
      } as Entity,
    ]),
  );
  expect(tess.segmentCount).toBeGreaterThan(10);
  expect(tess.bounds?.minX).toBeCloseTo(0, 5);
  expect(tess.bounds?.maxX).toBeCloseTo(4, 5);
});

test("parse converts SPLINE with control points and knots", () => {
  const doc = parseDxf(
    [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "SPLINE",
      "8",
      "0",
      "71",
      "3",
      "72",
      "8",
      "73",
      "4",
      "40",
      "0",
      "40",
      "0",
      "40",
      "0",
      "40",
      "0",
      "40",
      "1",
      "40",
      "1",
      "40",
      "1",
      "40",
      "1",
      "10",
      "0",
      "20",
      "0",
      "10",
      "1",
      "20",
      "3",
      "10",
      "3",
      "20",
      "3",
      "10",
      "4",
      "20",
      "0",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n"),
  );
  const spline = doc.entities[0];
  expect(spline).toMatchObject({ type: "SPLINE", degree: 3 });
  if (spline.type === "SPLINE") {
    expect(spline.controlPoints).toHaveLength(4);
    expect(spline.knots).toHaveLength(8);
  }
});
