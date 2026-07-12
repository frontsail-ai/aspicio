import { expect, test } from "vite-plus/test";
import type { Viewport } from "../src/model/types.ts";
import {
  applyAffine,
  clipPolygon,
  clipSegment,
  viewportRect,
  viewportTransform,
} from "../src/geom/viewport.ts";

// The fixture viewport: 130×90 window centered at (110,100) on the paper,
// framing a 30-unit-tall model view centered at (20,15) → scale 3.
const vp: Viewport = {
  center: { x: 110, y: 100 },
  width: 130,
  height: 90,
  viewCenter: { x: 20, y: 15 },
  viewHeight: 30,
  twist: 0,
};

test("viewportTransform maps the model view center to the window center", () => {
  const m = viewportTransform(vp);
  expect(applyAffine(m, { x: 20, y: 15 })).toEqual({ x: 110, y: 100 });
  expect(applyAffine(m, { x: 0, y: 0 })).toEqual({ x: 50, y: 55 }); // scale 3
  expect(applyAffine(m, { x: 40, y: 30 })).toEqual({ x: 170, y: 145 });
});

test("viewportTransform honors twist (90° CCW)", () => {
  const m = viewportTransform({ ...vp, twist: Math.PI / 2 });
  const p = applyAffine(m, { x: 30, y: 15 }); // 10 model units right of center
  // A 90° CCW twist sends "right" to "up": +x·scale on the paper y.
  expect(p.x).toBeCloseTo(110);
  expect(p.y).toBeCloseTo(130); // 100 + 10·3
});

test("viewportRect is the axis-aligned window", () => {
  expect(viewportRect(vp)).toEqual({ minX: 45, minY: 55, maxX: 175, maxY: 145 });
});

test("clipSegment trims a segment crossing the window edge", () => {
  const r = viewportRect(vp);
  // The model overshoot line maps to a vertical paper segment poking out the top.
  const clipped = clipSegment({ x: 110, y: 100 }, { x: 110, y: 205 }, r);
  expect(clipped).not.toBeNull();
  expect(clipped![0]).toEqual({ x: 110, y: 100 });
  expect(clipped![1]).toEqual({ x: 110, y: 145 }); // clamped to the top edge
});

test("clipSegment keeps fully-inside segments and drops fully-outside ones", () => {
  const r = viewportRect(vp);
  const inside = clipSegment({ x: 60, y: 60 }, { x: 160, y: 140 }, r);
  expect(inside).toEqual([
    { x: 60, y: 60 },
    { x: 160, y: 140 },
  ]);
  expect(clipSegment({ x: 0, y: 0 }, { x: 10, y: 10 }, r)).toBeNull();
});

test("clipPolygon clips a polygon to the window", () => {
  const r = viewportRect(vp);
  // A big square straddling the top edge is clipped to y ≤ 145.
  const clipped = clipPolygon(
    [
      { x: 60, y: 60 },
      { x: 160, y: 60 },
      { x: 160, y: 200 },
      { x: 60, y: 200 },
    ],
    r,
  );
  expect(clipped.length).toBeGreaterThanOrEqual(4);
  expect(Math.max(...clipped.map((p) => p.y))).toBeCloseTo(145);
  expect(
    clipPolygon(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      r,
    ),
  ).toEqual([]);
});
