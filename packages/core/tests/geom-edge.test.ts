import { expect, test } from "vite-plus/test";
import { sampleBulge, sampleEllipse } from "../src/geom/arc.ts";

test("negative bulge arcs to the opposite side", () => {
  const pos = sampleBulge({ x: 0, y: 0 }, { x: 2, y: 0 }, 1, 72);
  const neg = sampleBulge({ x: 0, y: 0 }, { x: 2, y: 0 }, -1, 72);
  const midPos = pos[Math.floor(pos.length / 2) - 1];
  const midNeg = neg[Math.floor(neg.length / 2) - 1];
  expect(Math.sign(midPos.y)).not.toBe(Math.sign(midNeg.y));
  expect(neg.at(-1)).toEqual({ x: 2, y: 0 });
});

test("coincident endpoints degrade gracefully", () => {
  expect(sampleBulge({ x: 3, y: 3 }, { x: 3, y: 3 }, 1, 72)).toEqual([{ x: 3, y: 3 }]);
});

test("tiny bulge behaves like a straight segment", () => {
  const points = sampleBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, 1e-12, 72);
  expect(points).toEqual([{ x: 10, y: 0 }]);
});

test("partial ellipse arc with wrap (end < start)", () => {
  // From 3π/2 to π/2: half the ellipse, passing through param 0 (major +X tip).
  const points = sampleEllipse(0, 0, 2, 0, 0.5, (3 * Math.PI) / 2, Math.PI / 2, 72);
  expect(points[0].y).toBeCloseTo(-1);
  expect(points.at(-1)?.y).toBeCloseTo(1);
  const maxX = Math.max(...points.map((p) => p.x));
  expect(maxX).toBeCloseTo(2, 1);
});

test("rotated major axis produces a tilted ellipse", () => {
  // Major axis along +Y, ratio 0.5 → minor along -X.
  const points = sampleEllipse(0, 0, 0, 3, 0.5, 0, 2 * Math.PI, 72);
  const maxY = Math.max(...points.map((p) => p.y));
  const minX = Math.min(...points.map((p) => p.x));
  expect(maxY).toBeCloseTo(3, 1);
  expect(minX).toBeCloseTo(-1.5, 1);
});
