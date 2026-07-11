import type { Point2 } from "../model/types.ts";

/** Default number of segments for a full circle. */
export const DEFAULT_CURVE_SEGMENTS = 72;

/** Number of polyline segments to approximate a sweep of `sweep` radians. */
export function segmentCount(sweep: number, curveSegments: number): number {
  const n = Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * curveSegments);
  return Math.max(2, Math.min(n, 256));
}

/** Sample an arc into points, inclusive of both endpoints. */
export function sampleArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  sweep: number,
  curveSegments: number,
): Point2[] {
  const n = segmentCount(sweep, curveSegments);
  const points: Point2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = startAngle + (sweep * i) / n;
    points.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return points;
}

/**
 * Expand a bulged polyline segment into arc points (excluding `p1`,
 * including `p2`). Bulge = tan(sweep/4), negative for clockwise arcs.
 * Same construction as ezdxf / three-dxf.
 */
export function sampleBulge(
  p1: Point2,
  p2: Point2,
  bulge: number,
  curveSegments: number,
): Point2[] {
  const sweep = 4 * Math.atan(bulge);
  const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (chord < 1e-12 || Math.abs(sweep) < 1e-9) return [p2];

  const radius = chord / (2 * Math.sin(sweep / 2));
  const chordAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const toCenter = chordAngle + Math.PI / 2 - sweep / 2;
  const cx = p1.x + radius * Math.cos(toCenter);
  const cy = p1.y + radius * Math.sin(toCenter);
  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);

  const points = sampleArc(cx, cy, Math.abs(radius), startAngle, sweep, curveSegments);
  points.shift(); // exclude p1
  points[points.length - 1] = p2; // exact endpoint
  return points;
}

/** Sample an ellipse defined the DXF way (major axis vector + ratio). */
export function sampleEllipse(
  cx: number,
  cy: number,
  majorX: number,
  majorY: number,
  axisRatio: number,
  startParam: number,
  endParam: number,
  curveSegments: number,
): Point2[] {
  let sweep = endParam - startParam;
  if (sweep <= 1e-9) sweep += 2 * Math.PI;
  const n = segmentCount(sweep, curveSegments);
  // Minor axis = major rotated 90° CCW, scaled by ratio.
  const minorX = -majorY * axisRatio;
  const minorY = majorX * axisRatio;
  const points: Point2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = startParam + (sweep * i) / n;
    const c = Math.cos(t);
    const s = Math.sin(t);
    points.push({ x: cx + majorX * c + minorX * s, y: cy + majorY * c + minorY * s });
  }
  return points;
}
