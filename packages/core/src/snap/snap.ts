import type { DxfDocument, Point2 } from "../model/types.ts";
import type { Tessellation } from "../tessellate/tessellate.ts";

/** Kinds of object snap, in the order they win ties (endpoint first). */
export type SnapKind = "endpoint" | "node" | "center" | "midpoint";

/** Kind names indexed by priority — a candidate stores the index (a Uint8). */
const KINDS: SnapKind[] = ["endpoint", "node", "center", "midpoint"];

export interface SnapResult {
  point: Point2;
  kind: SnapKind;
}

/**
 * A uniform-grid index of snap points in world coordinates. Candidates live in
 * parallel typed arrays (not objects) so a drawing with millions of vertices
 * stays cheap to build and hold; the grid maps a cell to candidate indices.
 */
export class SnapIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly kinds: Uint8Array;
  private readonly layerIdx: Int32Array;
  private readonly layerNames: string[];
  private readonly cell: number;

  constructor(
    xs: Float32Array,
    ys: Float32Array,
    kinds: Uint8Array,
    layerIdx: Int32Array,
    layerNames: string[],
    cell: number,
  ) {
    this.xs = xs;
    this.ys = ys;
    this.kinds = kinds;
    this.layerIdx = layerIdx;
    this.layerNames = layerNames;
    this.cell = cell;
    for (let i = 0; i < xs.length; i++) {
      const key = `${Math.floor(xs[i] / cell)},${Math.floor(ys[i] / cell)}`;
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(i);
    }
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
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gy = cy - r; gy <= cy + r; gy++) {
        const list = this.cells.get(`${gx},${gy}`);
        if (!list) continue;
        for (const i of list) {
          if (!isPickable(this.layerNames[this.layerIdx[i]])) continue;
          const dx = this.xs[i] - p.x;
          const dy = this.ys[i] - p.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > tolSq) continue;
          // Rank by kind first, then distance — a close endpoint beats a
          // slightly-closer midpoint.
          const score = this.kinds[i] * tolSq + distSq;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }
      }
    }
    if (bestIdx < 0) return null;
    return {
      point: { x: this.xs[bestIdx], y: this.ys[bestIdx] },
      kind: KINDS[this.kinds[bestIdx]],
    };
  }
}

/**
 * Collect snap candidates from a tessellation (segment endpoints and
 * midpoints, in world space) and the document (arc/circle/ellipse/insert
 * centers, and POINT nodes), and index them. Pre-sized typed arrays keep the
 * build allocation-light even for very large drawings.
 */
export function buildSnapIndex(tessellation: Tessellation, document: DxfDocument): SnapIndex {
  const { offset, bounds } = tessellation;

  // Pre-count so the typed arrays are allocated once (3 per segment).
  let count = 0;
  for (const geo of tessellation.layers.values()) count += (geo.positions.length / 6) * 3;
  for (const e of document.entities) {
    if (
      e.type === "CIRCLE" ||
      e.type === "ARC" ||
      e.type === "ELLIPSE" ||
      e.type === "INSERT" ||
      e.type === "POINT"
    ) {
      count += 1;
    }
  }

  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const kinds = new Uint8Array(count);
  const layerIdx = new Int32Array(count);
  const layerNames: string[] = [];
  const layerId = new Map<string, number>();
  const idOf = (name: string): number => {
    let id = layerId.get(name);
    if (id === undefined) {
      id = layerNames.length;
      layerNames.push(name);
      layerId.set(name, id);
    }
    return id;
  };

  let n = 0;
  const add = (x: number, y: number, kind: number, li: number): void => {
    xs[n] = x;
    ys[n] = y;
    kinds[n] = kind;
    layerIdx[n] = li;
    n++;
  };

  for (const [layer, geo] of tessellation.layers) {
    const li = idOf(layer);
    const p = geo.positions;
    for (let i = 0; i + 5 < p.length; i += 6) {
      const ax = p[i] + offset.x;
      const ay = p[i + 1] + offset.y;
      const bx = p[i + 3] + offset.x;
      const by = p[i + 4] + offset.y;
      add(ax, ay, 0, li); // endpoint
      add(bx, by, 0, li); // endpoint
      add((ax + bx) / 2, (ay + by) / 2, 3, li); // midpoint
    }
  }
  for (const e of document.entities) {
    if (e.type === "CIRCLE" || e.type === "ARC" || e.type === "ELLIPSE") {
      add(e.center.x, e.center.y, 2, idOf(e.layer)); // center
    } else if (e.type === "INSERT") {
      add(e.position.x, e.position.y, 2, idOf(e.layer)); // center
    } else if (e.type === "POINT") {
      add(e.position.x, e.position.y, 1, idOf(e.layer)); // node
    }
  }

  // Grid cell sized to the drawing so queries scan only a handful of cells.
  const span = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) : 1;
  const cell = Math.max(span / 128, 1e-6);
  return new SnapIndex(xs, ys, kinds, layerIdx, layerNames, cell);
}
