/**
 * Custom HATCH parser for dxf-parser (which has no built-in HATCH handler).
 * Reads the fill flag and boundary loops — polyline boundaries and
 * line/arc/ellipse edge boundaries — into a raw structure the model layer
 * samples into polygon loops. Best-effort: spline edges are skipped.
 */

interface RawGroup {
  code: number;
  value: number | string | boolean;
}

export interface HatchVertex {
  x: number;
  y: number;
  bulge: number;
}

export type HatchEdge =
  | { type: "line"; x1: number; y1: number; x2: number; y2: number }
  | {
      type: "arc";
      cx: number;
      cy: number;
      radius: number;
      start: number;
      end: number;
      ccw: boolean;
    };

export type HatchBoundary =
  | { kind: "polyline"; closed: boolean; vertices: HatchVertex[] }
  | { kind: "edges"; edges: HatchEdge[] };

export interface RawHatchEntity {
  type: string;
  layer?: string;
  lineType?: string;
  colorIndex?: number;
  color?: number;
  solid: boolean;
  boundaries: HatchBoundary[];
  handle?: number | string;
}

const num = (v: number | string | boolean): number => (typeof v === "number" ? v : Number(v));

function parseBoundaries(
  groups: RawGroup[],
  start: number,
  count: number,
): [HatchBoundary[], number] {
  const boundaries: HatchBoundary[] = [];
  let i = start;
  const at = (code: number): boolean => i < groups.length && groups[i].code === code;

  for (let p = 0; p < count && i < groups.length; p++) {
    // Each path begins with a 92 path-type flag.
    while (i < groups.length && groups[i].code !== 92) i++;
    if (i >= groups.length) break;
    const flag = num(groups[i].value);
    i++;
    const isPolyline = (flag & 2) !== 0;

    if (isPolyline) {
      let closed = false;
      let numVerts = 0;
      if (at(72)) i++; // has-bulge flag
      if (at(73)) {
        closed = num(groups[i].value) !== 0;
        i++;
      }
      if (at(93)) {
        numVerts = num(groups[i].value);
        i++;
      }
      const vertices: HatchVertex[] = [];
      for (let v = 0; v < numVerts && i + 1 < groups.length; v++) {
        const x = num(groups[i].value);
        const y = num(groups[i + 1].value);
        i += 2;
        let bulge = 0;
        if (at(42)) {
          bulge = num(groups[i].value);
          i++;
        }
        vertices.push({ x, y, bulge });
      }
      boundaries.push({ kind: "polyline", closed, vertices });
    } else {
      let numEdges = 0;
      if (at(93)) {
        numEdges = num(groups[i].value);
        i++;
      }
      const edges: HatchEdge[] = [];
      for (let e = 0; e < numEdges && i < groups.length; e++) {
        if (!at(72)) break;
        const edgeType = num(groups[i].value);
        i++;
        const readVals = (): Map<number, number> => {
          const vals = new Map<number, number>();
          while (i < groups.length && groups[i].code !== 72 && groups[i].code !== 92) {
            // Stop when the next edge (72) or path (92) begins.
            const c = groups[i].code;
            if (c === 97 || c === 75 || c === 76 || c === 98) break;
            vals.set(c, num(groups[i].value));
            i++;
          }
          return vals;
        };
        if (edgeType === 1) {
          const vals = readVals();
          edges.push({
            type: "line",
            x1: vals.get(10) ?? 0,
            y1: vals.get(20) ?? 0,
            x2: vals.get(11) ?? 0,
            y2: vals.get(21) ?? 0,
          });
        } else if (edgeType === 2) {
          const vals = readVals();
          edges.push({
            type: "arc",
            cx: vals.get(10) ?? 0,
            cy: vals.get(20) ?? 0,
            radius: vals.get(40) ?? 0,
            start: ((vals.get(50) ?? 0) * Math.PI) / 180,
            end: ((vals.get(51) ?? 360) * Math.PI) / 180,
            ccw: (vals.get(73) ?? 1) !== 0,
          });
        } else {
          // Ellipse/spline edge: skip its data (best-effort).
          readVals();
        }
      }
      boundaries.push({ kind: "edges", edges });
    }
  }
  return [boundaries, i];
}

export class HatchHandler {
  ForEntityName = "HATCH" as const;

  parseEntity(scanner: { next(): RawGroup; isEOF(): boolean }, curr: RawGroup): RawHatchEntity {
    const entity: RawHatchEntity = {
      type: String(curr.value),
      solid: false,
      boundaries: [],
    };
    const groups: RawGroup[] = [];
    let g = scanner.next();
    while (!scanner.isEOF() && g.code !== 0) {
      groups.push({ code: g.code, value: g.value });
      g = scanner.next();
    }

    for (let i = 0; i < groups.length; i++) {
      const { code, value } = groups[i];
      switch (code) {
        case 8:
          entity.layer = String(value);
          break;
        case 6:
          entity.lineType = String(value);
          break;
        case 62:
          entity.colorIndex = num(value);
          break;
        case 420:
          entity.color = num(value);
          break;
        case 5:
          entity.handle = value as number | string;
          break;
        case 2:
          entity.solid = entity.solid || String(value).toUpperCase() === "SOLID";
          break;
        case 70:
          entity.solid = entity.solid || num(value) === 1;
          break;
        case 91: {
          const [boundaries, next] = parseBoundaries(groups, i + 1, num(value));
          entity.boundaries = boundaries;
          i = next - 1;
          break;
        }
      }
    }
    return entity;
  }
}
