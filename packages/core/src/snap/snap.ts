import type { DxfDocument, Point2 } from "../model/types.ts";
import type { Tessellation } from "../tessellate/tessellate.ts";

/** Kinds of object snap, in the order they win ties (endpoint first). */
export type SnapKind = "endpoint" | "node" | "center" | "midpoint";

const PRIORITY: Record<SnapKind, number> = { endpoint: 0, node: 1, center: 2, midpoint: 3 };

export interface SnapResult {
  point: Point2;
  kind: SnapKind;
}

interface Candidate {
  x: number;
  y: number;
  kind: SnapKind;
  layer: string;
}

/**
 * A uniform-grid index of snap points in world coordinates. Built once per
 * load; queried per pointer move to latch the cursor onto meaningful points.
 */
export class SnapIndex {
  private readonly cells = new Map<string, Candidate[]>();
  private readonly cell: number;

  constructor(candidates: Candidate[], cell: number) {
    this.cell = cell > 0 ? cell : 1;
    for (const c of candidates) {
      const key = this.key(c.x, c.y);
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(c);
    }
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }

  /**
   * Nearest snap point to `p` within `tolerance` (world units). Ties within
   * `tolerance` prefer the higher-priority kind (endpoint > node > center >
   * midpoint). `isPickable` filters by layer (default: everything).
   */
  query(
    p: Point2,
    tolerance: number,
    isPickable: (layer: string) => boolean = () => true,
  ): SnapResult | null {
    const r = Math.max(1, Math.ceil(tolerance / this.cell));
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const tolSq = tolerance * tolerance;
    let best: Candidate | null = null;
    let bestScore = Infinity;
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gy = cy - r; gy <= cy + r; gy++) {
        const list = this.cells.get(`${gx},${gy}`);
        if (!list) continue;
        for (const c of list) {
          if (!isPickable(c.layer)) continue;
          const distSq = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
          if (distSq > tolSq) continue;
          // Rank by kind first, then distance — so a close endpoint beats a
          // slightly-closer midpoint.
          const score = PRIORITY[c.kind] * tolSq + distSq;
          if (score < bestScore) {
            bestScore = score;
            best = c;
          }
        }
      }
    }
    return best ? { point: { x: best.x, y: best.y }, kind: best.kind } : null;
  }
}

/**
 * Collect snap candidates from a tessellation (segment endpoints and
 * midpoints, in world space) and the document (arc/circle/ellipse/insert
 * centers, and POINT nodes), and index them.
 */
export function buildSnapIndex(tessellation: Tessellation, document: DxfDocument): SnapIndex {
  const candidates: Candidate[] = [];
  const { offset, bounds } = tessellation;
  const seen = new Set<string>();

  // Endpoints and midpoints from the batched line buffers (offset space →
  // add the offset back to get world coordinates).
  for (const [layer, geo] of tessellation.layers) {
    const p = geo.positions;
    for (let i = 0; i + 5 < p.length; i += 6) {
      const ax = p[i] + offset.x;
      const ay = p[i + 1] + offset.y;
      const bx = p[i + 3] + offset.x;
      const by = p[i + 4] + offset.y;
      pushUnique(candidates, seen, ax, ay, "endpoint", layer);
      pushUnique(candidates, seen, bx, by, "endpoint", layer);
      pushUnique(candidates, seen, (ax + bx) / 2, (ay + by) / 2, "midpoint", layer);
    }
  }

  // Centers and nodes come straight from the model (already world space).
  for (const e of document.entities) {
    if (e.type === "CIRCLE" || e.type === "ARC" || e.type === "ELLIPSE") {
      candidates.push({ x: e.center.x, y: e.center.y, kind: "center", layer: e.layer });
    } else if (e.type === "INSERT") {
      candidates.push({ x: e.position.x, y: e.position.y, kind: "center", layer: e.layer });
    } else if (e.type === "POINT") {
      candidates.push({ x: e.position.x, y: e.position.y, kind: "node", layer: e.layer });
    }
  }

  // Grid cell sized to the drawing so queries scan only a handful of cells.
  const span = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) : 1;
  const cell = Math.max(span / 128, 1e-6);
  return new SnapIndex(candidates, cell);
}

function pushUnique(
  out: Candidate[],
  seen: Set<string>,
  x: number,
  y: number,
  kind: SnapKind,
  layer: string,
): void {
  // Dedup coincident points (shared polyline vertices) at ~micron precision.
  const key = `${kind}:${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ x, y, kind, layer });
}
