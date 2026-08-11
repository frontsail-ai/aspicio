/**
 * Convex clipping geometry.
 *
 * The areas asserted here are the ones the PDF interpreter depends on being
 * exact: a fill that loses its hole, or a ring whose split halves fuse, is
 * invisible wrongness rather than honest incompleteness (PDF-3).
 */

import { expect, test } from "vite-plus/test";
import {
  classifyBox,
  clipContains,
  clipPolyline,
  clipRing,
  convexClipFromRing,
  intersectClips,
} from "../src/geom/clip.ts";
import type { ConvexClip } from "../src/geom/clip.ts";
import { triangulate } from "../src/geom/triangulate.ts";
import type { Point2 } from "../src/model/types.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Point2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const clipOf = (ring: Point2[]): ConvexClip => {
  const clip = convexClipFromRing(ring);
  expect(clip, "the fixture ring must be convex").toBeDefined();
  return clip as ConvexClip;
};

const area = (ring: readonly Point2[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point2;
    const b = ring[(i + 1) % ring.length] as Point2;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

/** Area of the triangles a set of rings actually renders as. */
const filledArea = (rings: Point2[][]): number => {
  const points = triangulate(rings);
  let sum = 0;
  for (let i = 0; i < points.length; i += 3) {
    const a = points[i] as Point2;
    const b = points[i + 1] as Point2;
    const c = points[i + 2] as Point2;
    sum += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }
  return sum;
};

const UNIT = clipOf(rect(0, 0, 10, 10));

/* ---------- building a region ---------- */

test("a rectangle in either winding becomes the same region", () => {
  const forward = clipOf(rect(0, 0, 10, 10));
  const reversed = clipOf([...rect(0, 0, 10, 10)].reverse());
  expect(area(forward.ring)).toBeCloseTo(100);
  expect(area(reversed.ring)).toBeCloseTo(100);
  expect(clipContains(reversed, { x: 5, y: 5 })).toBe(true);
});

test("a closing duplicate point does not make a ring degenerate", () => {
  // `re` emits five points for four corners, and every clip path may.
  const ring = [...rect(0, 0, 10, 10), { x: 0, y: 0 }];
  expect(convexClipFromRing(ring)?.ring).toHaveLength(4);
});

test("rings that cannot be regions are refused rather than guessed", () => {
  expect(convexClipFromRing(rect(3, 3, 3, 8))).toBeUndefined(); // zero width
  expect(
    convexClipFromRing([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]),
  ).toBeUndefined(); // too few
  expect(
    convexClipFromRing([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 2 },
      { x: 0, y: 10 },
    ]),
  ).toBeUndefined(); // concave
});

/* ---------- clipping rings ---------- */

test("a ring wholly inside or wholly outside comes back whole or empty", () => {
  expect(area(clipRing(rect(2, 2, 8, 8), UNIT))).toBeCloseTo(36);
  expect(clipRing(rect(50, 50, 60, 60), UNIT)).toHaveLength(0);
});

test("clipping each ring on its own preserves a fill's holes", () => {
  // A 20×20 square with a 10×10 hole, clipped to the left half: 100 of outer
  // survives, 25 of the hole, and the fill nets 75.
  const outer = clipRing(rect(0, 0, 20, 20), UNIT);
  const hole = clipRing(rect(5, 5, 15, 15), UNIT);
  expect(area(outer)).toBeCloseTo(100);
  expect(area(hole)).toBeCloseTo(25);
  expect(filledArea([outer, hole])).toBeCloseTo(75);
});

test("a ring the region splits in two still fills the right area", () => {
  // Sutherland–Hodgman joins the halves with a zero-width bridge rather than
  // returning two rings. Ear-clipping must not turn that into extra area.
  const u: Point2[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 7, y: 10 },
    { x: 7, y: 2 },
    { x: 3, y: 2 },
    { x: 3, y: 10 },
    { x: 0, y: 10 },
  ];
  const clipped = clipRing(u, clipOf(rect(0, 4, 10, 10)));
  expect(area(clipped)).toBeCloseTo(36);
  expect(filledArea([clipped])).toBeCloseTo(36);
});

/* ---------- clipping polylines ---------- */

test("a polyline is cut at the boundary, not at its vertices", () => {
  expect(
    clipPolyline(
      [
        { x: -5, y: 5 },
        { x: 15, y: 5 },
      ],
      UNIT,
    ),
  ).toEqual([
    [
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ],
  ]);
});

test("a polyline that leaves and re-enters yields one run per visit", () => {
  const pieces = clipPolyline(
    [
      { x: -5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 2 },
      { x: -5, y: 2 },
    ],
    UNIT,
  );
  // Never one run bridging the gap: that would draw a segment the caller
  // never asked for, straight across the excluded middle.
  expect(pieces).toHaveLength(2);
  expect(pieces[0]?.[0]).toEqual({ x: 0, y: 5 });
  expect(pieces[1]?.[1]).toEqual({ x: 0, y: 2 });
});

test("a polyline wholly outside survives as nothing", () => {
  expect(
    clipPolyline(
      [
        { x: 20, y: 20 },
        { x: 30, y: 30 },
      ],
      UNIT,
    ),
  ).toHaveLength(0);
});

/* ---------- intersection and the box test ---------- */

test("intersecting regions stays convex, and non-overlap reports as such", () => {
  // A diamond that reaches past each edge's midpoint but not the corners, so
  // the overlap is an octagon: 100 less the four corner triangles of 2 each.
  const rotated = clipOf([
    { x: 5, y: -3 },
    { x: 13, y: 5 },
    { x: 5, y: 13 },
    { x: -3, y: 5 },
  ]);
  const both = intersectClips(UNIT, rotated);
  expect(both).toBeDefined();
  expect((both as ConvexClip).ring).toHaveLength(8);
  expect(convexClipFromRing((both as ConvexClip).ring)).toBeDefined();
  expect(area((both as ConvexClip).ring)).toBeCloseTo(92);
  expect(intersectClips(UNIT, clipOf(rect(50, 50, 60, 60)))).toBeUndefined();
});

test("the box test answers inside, outside, and maybe", () => {
  expect(classifyBox({ minX: 2, minY: 2, maxX: 8, maxY: 8 }, UNIT)).toBe("inside");
  expect(classifyBox({ minX: 20, minY: 20, maxX: 30, maxY: 30 }, UNIT)).toBe("outside");
  expect(classifyBox({ minX: 5, minY: 5, maxX: 30, maxY: 30 }, UNIT)).toBe("partial");
});

test("a box overlapping only the bounds of an angled region reads as maybe", () => {
  // "partial" is permission to do the real work, never a promise that
  // anything survives it — the corner of a diamond's bounding box holds
  // none of the diamond.
  const diamond = clipOf([
    { x: 5, y: 0 },
    { x: 10, y: 5 },
    { x: 5, y: 10 },
    { x: 0, y: 5 },
  ]);
  expect(classifyBox({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, diamond)).toBe("partial");
  expect(clipRing(rect(0, 0, 1, 1), diamond)).toHaveLength(0);
});
