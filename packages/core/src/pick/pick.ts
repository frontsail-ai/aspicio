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
