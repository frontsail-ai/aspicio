import type { Point2 } from "../model/types.ts";

const EPS = 1e-9;

/**
 * Split a polyline into the "drawn" sub-polylines of a linetype dash pattern
 * (positive = dash, negative = gap, 0 = dot), measured in the polyline's own
 * coordinate units. The dash phase carries continuously across vertices, so a
 * dashed polyline looks right around corners. Returns the visible pieces; an
 * empty or continuous pattern should not reach here.
 */
export function dashPolyline(points: Point2[], pattern: number[]): Point2[][] {
  if (points.length < 2 || pattern.length === 0) return [points];
  const total = pattern.reduce((s, v) => s + Math.abs(v), 0);
  if (total <= EPS) return [points];
  const dotLen = total * 0.05;

  const on = pattern.map((v) => v >= 0);
  const len = pattern.map((v) => (Math.abs(v) < EPS ? dotLen : Math.abs(v)));

  let pi = 0;
  let remain = len[0];
  let drawing = on[0];
  const result: Point2[][] = [];
  let cur: Point2[] | null = drawing ? [points[0]] : null;

  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s];
    const b = points[s + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < EPS) continue;
    const ux = dx / segLen;
    const uy = dy / segLen;
    let pos = 0;
    while (pos < segLen - EPS) {
      const step = Math.min(remain, segLen - pos);
      pos += step;
      remain -= step;
      const pt = { x: a.x + ux * pos, y: a.y + uy * pos };
      if (drawing && cur) cur.push(pt);
      if (remain <= EPS) {
        if (drawing && cur && cur.length >= 2) result.push(cur);
        pi = (pi + 1) % pattern.length;
        remain = len[pi];
        drawing = on[pi];
        cur = drawing ? [{ x: a.x + ux * pos, y: a.y + uy * pos }] : null;
      }
    }
  }
  if (drawing && cur && cur.length >= 2) result.push(cur);
  return result;
}
