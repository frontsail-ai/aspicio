import type { Point2 } from "../model/types.ts";

/**
 * Clamped uniform knot vector for `numControl` control points of the given
 * degree: the curve passes through the first and last control points.
 * Length = numControl + degree + 1.
 */
export function clampedKnots(numControl: number, degree: number): number[] {
  const n = numControl - 1;
  const p = degree;
  const knots: number[] = [];
  for (let i = 0; i <= n + p + 1; i++) {
    if (i <= p) knots.push(0);
    else if (i > n) knots.push(n - p + 1);
    else knots.push(i - p);
  }
  return knots;
}

/** Knot span index k with U[k] <= x < U[k+1] (clamped at the end). */
function findSpan(x: number, knots: number[], n: number, p: number): number {
  if (x >= knots[n + 1]) return n;
  let lo = p;
  let hi = n + 1;
  let mid = (lo + hi) >> 1;
  while (x < knots[mid] || x >= knots[mid + 1]) {
    if (x < knots[mid]) hi = mid;
    else lo = mid;
    mid = (lo + hi) >> 1;
  }
  return mid;
}

/** Evaluate a B-spline at parameter x via De Boor's algorithm. */
function deBoor(x: number, knots: number[], control: Point2[], p: number): Point2 {
  const n = control.length - 1;
  const k = findSpan(x, knots, n, p);
  const d: Point2[] = [];
  for (let j = 0; j <= p; j++) {
    const c = control[j + k - p];
    d.push({ x: c.x, y: c.y });
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const denom = knots[j + 1 + k - r] - knots[j + k - p];
      const a = denom === 0 ? 0 : (x - knots[j + k - p]) / denom;
      d[j] = {
        x: (1 - a) * d[j - 1].x + a * d[j].x,
        y: (1 - a) * d[j - 1].y + a * d[j].y,
      };
    }
  }
  return d[p];
}

/**
 * Sample a B-spline (DXF SPLINE) into a polyline. Non-rational; weights are
 * not applied (dxf-parser does not expose them). A missing or malformed knot
 * vector is replaced with a clamped uniform one.
 */
export function sampleSpline(
  controlPoints: Point2[],
  knots: number[],
  degree: number,
  segments: number,
): Point2[] {
  const p = Math.min(Math.max(1, degree), controlPoints.length - 1);
  const expected = controlPoints.length + p + 1;
  const U = knots.length === expected ? knots : clampedKnots(controlPoints.length, p);

  const n = controlPoints.length - 1;
  const start = U[p];
  const end = U[n + 1];
  const steps = Math.max(2, Math.min(segments, 512));
  const points: Point2[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = start + ((end - start) * i) / steps;
    points.push(deBoor(x, U, controlPoints, p));
  }
  return points;
}
