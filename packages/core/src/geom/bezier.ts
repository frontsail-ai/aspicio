/**
 * Cubic Bézier flattening.
 *
 * PDF draws curves with cubics where DXF uses arcs and splines, so this is the
 * one geometric primitive PDF adds. Segment counts follow the same policy as
 * `sampleArc`: proportional to how much curve there is, clamped at both ends,
 * and driven by the same `curveSegments` option so one setting governs
 * curve fidelity across every format.
 */

import type { Point2 } from "../model/types.ts";
import { DEFAULT_CURVE_SEGMENTS } from "./arc.ts";

/** Chord-and-control-net estimate of a cubic's arc length. */
function approximateLength(p0: Point2, p1: Point2, p2: Point2, p3: Point2): number {
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const net =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);
  // The true length lies between the chord and the control net; their mean is
  // the standard cheap estimate and errs slightly long, which is the safe way
  // to err when it decides how many segments to spend.
  return (chord + net) / 2;
}

/**
 * How many segments to spend on one cubic.
 *
 * Scale matters: a curve spanning thousands of drawing units needs more
 * segments than a glyph-sized one, so the count grows with the ratio of the
 * curve's length to the straight-line distance it covers — flat curves get
 * few segments, tightly wound ones get many.
 */
export function bezierSegmentCount(
  p0: Point2,
  p1: Point2,
  p2: Point2,
  p3: Point2,
  curveSegments: number = DEFAULT_CURVE_SEGMENTS,
): number {
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const length = approximateLength(p0, p1, p2, p3);
  if (length === 0) return 1;
  // A cubic bends through at most half a turn's worth of direction change in
  // practice, so a quarter of the full-circle budget is the natural ceiling.
  const curviness = chord === 0 ? 1 : Math.min(4, length / Math.max(chord, 1e-9));
  const n = Math.ceil((curviness / 4) * curveSegments);
  return Math.max(2, Math.min(n, 64));
}

/**
 * Sample a cubic, excluding the start point.
 *
 * The start is omitted because callers append to a path that already ends at
 * `p0`; including it would duplicate a vertex on every curve.
 */
export function sampleCubic(
  p0: Point2,
  p1: Point2,
  p2: Point2,
  p3: Point2,
  curveSegments: number = DEFAULT_CURVE_SEGMENTS,
): Point2[] {
  const n = bezierSegmentCount(p0, p1, p2, p3, curveSegments);
  const out: Point2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
  return out;
}
