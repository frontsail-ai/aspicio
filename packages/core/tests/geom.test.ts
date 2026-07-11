import { expect, test } from "vite-plus/test";
import { sampleArc, sampleBulge, sampleEllipse, segmentCount } from "../src/geom/arc.ts";

test("segmentCount scales with sweep and clamps", () => {
  expect(segmentCount(2 * Math.PI, 72)).toBe(72);
  expect(segmentCount(Math.PI, 72)).toBe(36);
  expect(segmentCount(0.0001, 72)).toBe(2);
  expect(segmentCount(2 * Math.PI, 100_000)).toBe(256);
});

test("sampleArc endpoints are exact-ish", () => {
  const points = sampleArc(0, 0, 1, 0, Math.PI / 2, 72);
  expect(points[0].x).toBeCloseTo(1);
  expect(points[0].y).toBeCloseTo(0);
  expect(points.at(-1)?.x).toBeCloseTo(0);
  expect(points.at(-1)?.y).toBeCloseTo(1);
});

test("bulge=1 semicircle passes through expected midpoint", () => {
  // Same construction as ezdxf/three-dxf: CCW sweep of 4*atan(1)=π.
  const points = sampleBulge({ x: 0, y: 0 }, { x: 2, y: 0 }, 1, 72);
  const mid = points[Math.floor(points.length / 2) - 1];
  expect(Math.hypot(mid.x - 1, mid.y)).toBeCloseTo(1); // on the circle
  expect(points.at(-1)).toEqual({ x: 2, y: 0 }); // exact endpoint
});

test("bulge=0 degenerates to the endpoint", () => {
  expect(sampleBulge({ x: 0, y: 0 }, { x: 5, y: 5 }, 0, 72)).toEqual([{ x: 5, y: 5 }]);
});

test("sampleEllipse traces major and minor axes", () => {
  // Major axis along +X length 2, ratio 0.5 → minor along +Y length 1.
  const points = sampleEllipse(0, 0, 2, 0, 0.5, 0, 2 * Math.PI, 72);
  expect(points[0].x).toBeCloseTo(2);
  expect(points[0].y).toBeCloseTo(0);
  const quarter = points[Math.round((points.length - 1) / 4)];
  expect(quarter.x).toBeCloseTo(0, 1);
  expect(quarter.y).toBeCloseTo(1, 1);
});
