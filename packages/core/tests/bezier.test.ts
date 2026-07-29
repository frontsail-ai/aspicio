import { expect, test } from "vite-plus/test";
import { bezierSegmentCount, sampleCubic } from "../src/geom/bezier.ts";
import type { Point2 } from "../src/model/types.ts";

const p = (x: number, y: number): Point2 => ({ x, y });

/** Exact cubic evaluation, to check the sampler against the definition. */
function exact(p0: Point2, p1: Point2, p2: Point2, p3: Point2, t: number): Point2 {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y,
  };
}

test("samples exclude the start point and end exactly on the last", () => {
  const points = sampleCubic(p(0, 0), p(0, 10), p(10, 10), p(10, 0));
  expect(points[0]).not.toEqual(p(0, 0));
  const last = points[points.length - 1];
  expect(last?.x).toBeCloseTo(10, 10);
  expect(last?.y).toBeCloseTo(0, 10);
});

test("sampled points lie on the curve", () => {
  const [p0, p1, p2, p3] = [p(0, 0), p(0, 10), p(10, 10), p(10, 0)];
  const points = sampleCubic(p0, p1, p2, p3);
  const n = points.length;
  for (const [i, point] of points.entries()) {
    const expected = exact(p0, p1, p2, p3, (i + 1) / n);
    expect(point.x).toBeCloseTo(expected.x, 10);
    expect(point.y).toBeCloseTo(expected.y, 10);
  }
});

test("a straight cubic still produces a usable polyline", () => {
  const points = sampleCubic(p(0, 0), p(3, 0), p(6, 0), p(9, 0));
  expect(points.length).toBeGreaterThanOrEqual(2);
  for (const point of points) expect(point.y).toBeCloseTo(0, 10);
  expect(points[points.length - 1]?.x).toBeCloseTo(9, 10);
});

test("a degenerate cubic collapses without dividing by zero", () => {
  const points = sampleCubic(p(5, 5), p(5, 5), p(5, 5), p(5, 5));
  expect(points.length).toBeGreaterThanOrEqual(1);
  for (const point of points) {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(point).toEqual(p(5, 5));
  }
});

// Segment count follows sampleArc's policy: proportional, clamped both ends.
test("curvier cubics get more segments than flat ones", () => {
  const flat = bezierSegmentCount(p(0, 0), p(3, 0), p(6, 0), p(9, 0));
  const curvy = bezierSegmentCount(p(0, 0), p(0, 40), p(40, 40), p(40, 0));
  expect(curvy).toBeGreaterThan(flat);
});

test("segment count honours the curveSegments budget", () => {
  const coarse = bezierSegmentCount(p(0, 0), p(0, 40), p(40, 40), p(40, 0), 8);
  const fine = bezierSegmentCount(p(0, 0), p(0, 40), p(40, 40), p(40, 0), 360);
  expect(fine).toBeGreaterThan(coarse);
  expect(sampleCubic(p(0, 0), p(0, 40), p(40, 40), p(40, 0), 360)).toHaveLength(fine);
});

test("segment count stays within its clamps", () => {
  expect(bezierSegmentCount(p(0, 0), p(0, 0), p(0, 0), p(1, 0), 1)).toBeGreaterThanOrEqual(2);
  // A pathological control net must not explode the vertex count.
  expect(
    bezierSegmentCount(p(0, 0), p(1e6, 1e6), p(-1e6, -1e6), p(1, 0), 100000),
  ).toBeLessThanOrEqual(64);
});

test("scale does not change how many segments a shape gets", () => {
  const small = bezierSegmentCount(p(0, 0), p(0, 1), p(1, 1), p(1, 0));
  const large = bezierSegmentCount(p(0, 0), p(0, 1000), p(1000, 1000), p(1000, 0));
  // The same shape at a different size is the same curve: fidelity is about
  // shape, and the renderer's own scaling handles the rest.
  expect(large).toBe(small);
});
