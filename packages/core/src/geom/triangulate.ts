import { ShapeUtils, Vector2 } from "three";
import type { Point2 } from "../model/types.ts";

/**
 * Triangulate a polygon into a flat list of triangle vertices (every three
 * points form one triangle). `rings[0]` is the outer contour; `rings[1..]`
 * are holes. Uses three's ear-clipping (pure math, no GPU).
 */
export function triangulate(rings: Point2[][]): Point2[] {
  if (rings.length === 0 || rings[0].length < 3) return [];
  const contour = rings[0].map((p) => new Vector2(p.x, p.y));
  const holes = rings.slice(1).map((h) => h.map((p) => new Vector2(p.x, p.y)));
  const faces = ShapeUtils.triangulateShape(contour, holes);
  const all = [...contour, ...holes.flat()];
  const out: Point2[] = [];
  for (const [a, b, c] of faces) {
    const va = all[a];
    const vb = all[b];
    const vc = all[c];
    out.push({ x: va.x, y: va.y }, { x: vb.x, y: vb.y }, { x: vc.x, y: vc.y });
  }
  return out;
}
