import { DEFAULT_CURVE_SEGMENTS, sampleArc, sampleBulge, sampleEllipse } from "../geom/arc.ts";
import type { Bounds, DxfDocument, Entity, EntityType, Point2 } from "../model/types.ts";

/** 2D affine transform: [a, b, c, d, tx, ty] mapping (x,y) → (a·x+c·y+tx, b·x+d·y+ty). */
type Affine = [number, number, number, number, number, number];

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const MAX_INSERT_DEPTH = 16;

/** Batched line-segment geometry for one layer. */
export interface LayerGeometry {
  /** xyz triplets, two vertices per segment. */
  positions: Float32Array;
  /** rgb (0..1) per vertex. */
  colors: Float32Array;
}

export interface Tessellation {
  layers: Map<string, LayerGeometry>;
  bounds: Bounds | null;
  /** World-space offset subtracted from all positions (float precision guard). */
  offset: Point2;
  /** Total line segments emitted. */
  segmentCount: number;
}

export interface TessellationContext {
  /** Emit a polyline (in entity-local coordinates); transform/color applied. */
  addPolyline(points: Point2[], closed?: boolean): void;
  /** Recurse into a block for INSERT-like entities. */
  addBlock(blockName: string, transform: Affine, layer: string, color: number | null): void;
  readonly curveSegments: number;
}

export type EntityHandler = (entity: Entity, ctx: TessellationContext) => void;

const handlers = new Map<EntityType, EntityHandler>();

/** Extension point: register or override tessellation for an entity type. */
export function registerEntityHandler(type: EntityType, handler: EntityHandler): void {
  handlers.set(type, handler);
}

registerEntityHandler("LINE", (e, ctx) => {
  if (e.type !== "LINE") return;
  ctx.addPolyline([e.start, e.end]);
});

registerEntityHandler("POLYLINE", (e, ctx) => {
  if (e.type !== "POLYLINE") return;
  const out: Point2[] = [e.points[0]];
  const last = e.closed ? e.points.length : e.points.length - 1;
  for (let i = 0; i < last; i++) {
    const p1 = e.points[i];
    const p2 = e.points[(i + 1) % e.points.length];
    const bulge = e.bulges[i] ?? 0;
    if (bulge === 0) out.push(p2);
    else out.push(...sampleBulge(p1, p2, bulge, ctx.curveSegments));
  }
  ctx.addPolyline(out);
});

registerEntityHandler("CIRCLE", (e, ctx) => {
  if (e.type !== "CIRCLE") return;
  ctx.addPolyline(sampleArc(e.center.x, e.center.y, e.radius, 0, 2 * Math.PI, ctx.curveSegments));
});

registerEntityHandler("ARC", (e, ctx) => {
  if (e.type !== "ARC") return;
  let sweep = e.endAngle - e.startAngle;
  if (sweep <= 1e-9) sweep += 2 * Math.PI;
  ctx.addPolyline(
    sampleArc(e.center.x, e.center.y, e.radius, e.startAngle, sweep, ctx.curveSegments),
  );
});

registerEntityHandler("ELLIPSE", (e, ctx) => {
  if (e.type !== "ELLIPSE") return;
  ctx.addPolyline(
    sampleEllipse(
      e.center.x,
      e.center.y,
      e.majorAxis.x,
      e.majorAxis.y,
      e.axisRatio,
      e.startParam,
      e.endParam,
      ctx.curveSegments,
    ),
  );
});

registerEntityHandler("INSERT", (e, ctx) => {
  if (e.type !== "INSERT") return;
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  // T(position) · R(rotation) · S(scale)
  const transform: Affine = [
    cos * e.scale.x,
    sin * e.scale.x,
    -sin * e.scale.y,
    cos * e.scale.y,
    e.position.x,
    e.position.y,
  ];
  ctx.addBlock(e.blockName, transform, e.layer, e.color);
});

function multiply(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

interface Accumulator {
  positions: number[];
  colors: number[];
}

export interface TessellateOptions {
  curveSegments?: number;
}

/** Tessellate a document into per-layer batched line segments. */
export function tessellate(doc: DxfDocument, options: TessellateOptions = {}): Tessellation {
  const curveSegments = options.curveSegments ?? DEFAULT_CURVE_SEGMENTS;
  const accumulators = new Map<string, Accumulator>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let segmentCount = 0;

  const layerColor = (name: string): number => doc.layers.get(name)?.color ?? 0xffffff;

  function walk(
    entities: Entity[],
    transform: Affine,
    layerOverride: string | null,
    colorOverride: number | null,
    depth: number,
  ): void {
    for (const entity of entities) {
      // CAD rule: block entities on layer "0" belong to the insert's layer.
      const layer = layerOverride !== null && entity.layer === "0" ? layerOverride : entity.layer;
      const color = entity.color ?? colorOverride ?? layerColor(layer);

      const ctx: TessellationContext = {
        curveSegments,
        addPolyline(points, closed = false) {
          if (points.length < 2) return;
          let acc = accumulators.get(layer);
          if (!acc) {
            acc = { positions: [], colors: [] };
            accumulators.set(layer, acc);
          }
          const r = ((color >> 16) & 0xff) / 255;
          const g = ((color >> 8) & 0xff) / 255;
          const b = (color & 0xff) / 255;
          const n = closed ? points.length : points.length - 1;
          for (let i = 0; i < n; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const x1 = transform[0] * p1.x + transform[2] * p1.y + transform[4];
            const y1 = transform[1] * p1.x + transform[3] * p1.y + transform[5];
            const x2 = transform[0] * p2.x + transform[2] * p2.y + transform[4];
            const y2 = transform[1] * p2.x + transform[3] * p2.y + transform[5];
            acc.positions.push(x1, y1, 0, x2, y2, 0);
            acc.colors.push(r, g, b, r, g, b);
            segmentCount += 1;
            if (x1 < minX) minX = x1;
            if (x1 > maxX) maxX = x1;
            if (y1 < minY) minY = y1;
            if (y1 > maxY) maxY = y1;
            if (x2 < minX) minX = x2;
            if (x2 > maxX) maxX = x2;
            if (y2 < minY) minY = y2;
            if (y2 > maxY) maxY = y2;
          }
        },
        addBlock(blockName, local, insertLayer, insertColor) {
          if (depth >= MAX_INSERT_DEPTH) return;
          const block = doc.blocks.get(blockName);
          if (!block) return;
          const base: Affine = [1, 0, 0, 1, -block.basePoint.x, -block.basePoint.y];
          const combined = multiply(transform, multiply(local, base));
          walk(
            block.entities,
            combined,
            layerOverride !== null && insertLayer === "0" ? layerOverride : insertLayer,
            entity.color ?? insertColor ?? colorOverride,
            depth + 1,
          );
        },
      };

      handlers.get(entity.type)?.(entity, ctx);
    }
  }

  walk(doc.entities, IDENTITY, null, null, 0);

  const bounds: Bounds | null = minX <= maxX ? { minX, minY, maxX, maxY } : null;
  const offset: Point2 = bounds
    ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
    : { x: 0, y: 0 };

  const layers = new Map<string, LayerGeometry>();
  for (const [name, acc] of accumulators) {
    const positions = new Float32Array(acc.positions.length);
    for (let i = 0; i < acc.positions.length; i += 3) {
      positions[i] = acc.positions[i] - offset.x;
      positions[i + 1] = acc.positions[i + 1] - offset.y;
      positions[i + 2] = 0;
    }
    layers.set(name, { positions, colors: new Float32Array(acc.colors) });
  }

  return { layers, bounds, offset, segmentCount };
}
