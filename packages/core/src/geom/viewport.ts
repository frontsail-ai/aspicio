import type { Affine2D, Point2, Viewport } from "../model/types.ts";

/** Axis-aligned rectangle in paper coordinates. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The viewport's window on the paper (axis-aligned). */
export function viewportRect(vp: Viewport): Rect {
  const hw = vp.width / 2;
  const hh = vp.height / 2;
  return {
    minX: vp.center.x - hw,
    minY: vp.center.y - hh,
    maxX: vp.center.x + hw,
    maxY: vp.center.y + hh,
  };
}

/**
 * Affine mapping a model point to paper coordinates for a viewport:
 * `P = center + scale · R(twist) · (M − viewCenter)`, with
 * `scale = height / viewHeight`.
 */
export function viewportTransform(vp: Viewport): Affine2D {
  const s = vp.height / vp.viewHeight;
  const cos = Math.cos(vp.twist);
  const sin = Math.sin(vp.twist);
  const a = s * cos;
  const b = s * sin;
  const c = -s * sin;
  const d = s * cos;
  const tx = vp.center.x - (a * vp.viewCenter.x + c * vp.viewCenter.y);
  const ty = vp.center.y - (b * vp.viewCenter.x + d * vp.viewCenter.y);
  return [a, b, c, d, tx, ty];
}

/** Apply a 2D affine to a point. */
export function applyAffine(m: Affine2D, p: Point2): Point2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/**
 * Clip segment a→b to `r` (Liang–Barsky). Returns the visible sub-segment,
 * or null if it lies entirely outside.
 */
export function clipSegment(a: Point2, b: Point2, r: Rect): [Point2, Point2] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.minX, r.maxX - a.x, a.y - r.minY, r.maxY - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null; // parallel and outside this edge
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/**
 * Clip a polygon to `r` (Sutherland–Hodgman against the four edges). Returns
 * the clipped ring (possibly empty).
 */
export function clipPolygon(poly: Point2[], r: Rect): Point2[] {
  if (poly.length < 3) return [];
  let out = poly;
  out = clipHalfPlane(
    out,
    (p) => p.x >= r.minX,
    (a, b) => crossX(a, b, r.minX),
  );
  out = clipHalfPlane(
    out,
    (p) => p.x <= r.maxX,
    (a, b) => crossX(a, b, r.maxX),
  );
  out = clipHalfPlane(
    out,
    (p) => p.y >= r.minY,
    (a, b) => crossY(a, b, r.minY),
  );
  out = clipHalfPlane(
    out,
    (p) => p.y <= r.maxY,
    (a, b) => crossY(a, b, r.maxY),
  );
  return out;
}

function clipHalfPlane(
  poly: Point2[],
  inside: (p: Point2) => boolean,
  intersect: (a: Point2, b: Point2) => Point2,
): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

function crossX(a: Point2, b: Point2, x: number): Point2 {
  const t = (x - a.x) / (b.x - a.x);
  return { x, y: a.y + t * (b.y - a.y) };
}

function crossY(a: Point2, b: Point2, y: number): Point2 {
  const t = (y - a.y) / (b.y - a.y);
  return { x: a.x + t * (b.x - a.x), y };
}
