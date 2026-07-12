import type { Point2 } from "../model/types.ts";
import type { Tessellation } from "../tessellate/tessellate.ts";

/** Squared distance from point p to segment (x1,y1)-(x2,y2). */
function distanceSqToSegment(p: Point2, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = 0;
  if (lengthSq > 0) {
    t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / lengthSq));
  }
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

/** True if p lies inside triangle (ax,ay)-(bx,by)-(cx,cy) (any winding). */
function pointInTriangle(
  p: Point2,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = (p.x - bx) * (ay - by) - (ax - bx) * (p.y - by);
  const d2 = (p.x - cx) * (by - cy) - (bx - cx) * (p.y - cy);
  const d3 = (p.x - ax) * (cy - ay) - (cx - ax) * (p.y - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** A geometry hit: the top-level entity it belongs to and its layer. */
export interface EntityHit {
  /** Index into `document.entities`. */
  entityId: number;
  layer: string;
}

/**
 * Find the top-level entity whose geometry is closest to `point` (in
 * tessellation space, i.e. offset-corrected world coordinates). Line
 * segments within `tolerance` win first (nearest); otherwise a filled
 * triangle containing the point is returned (so clicking inside a SOLID or
 * solid HATCH selects it). Returns null when nothing is hit.
 */
export function pickEntity(
  tessellation: Tessellation,
  point: Point2,
  tolerance: number,
  isLayerPickable: (name: string) => boolean = () => true,
): EntityHit | null {
  let best: EntityHit | null = null;
  let bestDistSq = tolerance * tolerance;

  // Pass 1: line segments — edges are clickable and take priority over fills.
  for (const [name, layer] of tessellation.layers) {
    if (!isLayerPickable(name)) continue;
    const p = layer.positions;
    const ids = layer.segmentIds;
    for (let i = 0, s = 0; i + 5 < p.length; i += 6, s++) {
      const distSq = distanceSqToSegment(point, p[i], p[i + 1], p[i + 3], p[i + 4]);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { entityId: ids[s], layer: name };
      }
    }
  }
  if (best) return best;

  // Pass 2: filled interiors — first triangle containing the point wins.
  for (const [name, layer] of tessellation.layers) {
    if (!isLayerPickable(name)) continue;
    const fp = layer.fillPositions;
    const fids = layer.fillIds;
    for (let i = 0, t = 0; i + 8 < fp.length; i += 9, t++) {
      if (pointInTriangle(point, fp[i], fp[i + 1], fp[i + 3], fp[i + 4], fp[i + 6], fp[i + 7])) {
        return { entityId: fids[t], layer: name };
      }
    }
  }
  return null;
}

/**
 * Find the layer whose geometry is closest to `point` (in tessellation
 * space, i.e. offset-corrected world coordinates), within `tolerance`.
 * Pure math over the batched buffers — no renderer involved.
 */
export function pickLayer(
  tessellation: Tessellation,
  point: Point2,
  tolerance: number,
  isLayerPickable: (name: string) => boolean = () => true,
): string | null {
  let best: string | null = null;
  let bestDistSq = tolerance * tolerance;

  for (const [name, layer] of tessellation.layers) {
    if (!isLayerPickable(name)) continue;
    const p = layer.positions;
    for (let i = 0; i + 5 < p.length; i += 6) {
      const distSq = distanceSqToSegment(point, p[i], p[i + 1], p[i + 3], p[i + 4]);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = name;
      }
    }
  }
  return best;
}
