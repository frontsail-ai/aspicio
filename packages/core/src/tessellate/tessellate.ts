import { DEFAULT_CURVE_SEGMENTS, sampleArc, sampleBulge, sampleEllipse } from "../geom/arc.ts";
import { dashPolyline } from "../geom/dash.ts";
import { ocsToWcs } from "../geom/ocs.ts";
import { sampleSpline } from "../geom/spline.ts";
import { triangulate } from "../geom/triangulate.ts";
import type { Affine2D, Bounds, DxfDocument, Entity, EntityType, Point2 } from "../model/types.ts";
import { layoutText } from "../text/layout.ts";

type Affine = Affine2D;

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const MAX_INSERT_DEPTH = 16;

/** Batched line-segment (and optional filled-triangle) geometry for one layer. */
export interface LayerGeometry {
  /** xyz triplets, two vertices per line segment. */
  positions: Float32Array;
  /** rgb (0..1) per line vertex. */
  colors: Float32Array;
  /** xyz triplets, three vertices per filled triangle (SOLID, HATCH, …). */
  fillPositions: Float32Array;
  /** rgb (0..1) per fill vertex. */
  fillColors: Float32Array;
}

export interface Tessellation {
  layers: Map<string, LayerGeometry>;
  bounds: Bounds | null;
  /** World-space offset subtracted from all positions (float precision guard). */
  offset: Point2;
  /** Total line segments emitted. */
  segmentCount: number;
  /**
   * Colors actually drawn per layer (24-bit RGB → segment count). Unlike the
   * layer-table color, this reflects per-entity overrides, ByBlock
   * inheritance, and block layer rules — what the viewer really shows.
   */
  layerColors: Map<string, Map<number, number>>;
}

export interface TessellationContext {
  /** Emit a polyline (in entity-local coordinates); transform/color applied. */
  addPolyline(points: Point2[], closed?: boolean): void;
  /**
   * Fill a polygon (entity-local coords) with triangles. `rings[0]` is the
   * outer contour; `rings[1..]` are holes. Used by SOLID, 3DFACE, HATCH.
   */
  addFill(rings: Point2[][]): void;
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

registerEntityHandler("SPLINE", (e, ctx) => {
  if (e.type !== "SPLINE") return;
  ctx.addPolyline(sampleSpline(e.controlPoints, e.knots, e.degree, ctx.curveSegments), e.closed);
});

registerEntityHandler("TEXT", (e, ctx) => {
  if (e.type !== "TEXT") return;
  const strokes = layoutText(e.text, {
    height: e.height,
    widthFactor: e.widthFactor,
    hAlign: e.hAlign,
    vAlign: e.vAlign,
  });
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  for (const stroke of strokes) {
    // Rotate around the insertion point, then translate to it.
    ctx.addPolyline(
      stroke.map((p) => ({
        x: e.position.x + p.x * cos - p.y * sin,
        y: e.position.y + p.x * sin + p.y * cos,
      })),
    );
  }
});

registerEntityHandler("SOLID", (e, ctx) => {
  if (e.type !== "SOLID") return;
  ctx.addFill([e.points]);
});

registerEntityHandler("HATCH", (e, ctx) => {
  if (e.type !== "HATCH") return;
  if (e.solid) {
    // Fill the loops as a polygon with holes (first loop outer, rest holes).
    ctx.addFill(e.loops);
  } else {
    // Pattern hatch: draw the boundary outlines (pattern lines are v-next).
    for (const loop of e.loops) ctx.addPolyline(loop, true);
  }
});

/** POINT marker half-size in drawing units. */
const POINT_MARK = 0.6;

registerEntityHandler("POINT", (e, ctx) => {
  if (e.type !== "POINT") return;
  const { x, y } = e.position;
  ctx.addPolyline([
    { x: x - POINT_MARK, y },
    { x: x + POINT_MARK, y },
  ]);
  ctx.addPolyline([
    { x, y: y - POINT_MARK },
    { x, y: y + POINT_MARK },
  ]);
});

registerEntityHandler("DIMENSION", (e, ctx) => {
  if (e.type !== "DIMENSION") return;
  // The anonymous block holds the pre-computed lines, arrowheads, and text.
  ctx.addBlock(e.block, [1, 0, 0, 1, e.position.x, e.position.y], e.layer, e.color);
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
  fillPositions: number[];
  fillColors: number[];
}

export interface TessellateOptions {
  curveSegments?: number;
}

/** Tessellate a document into per-layer batched line segments. */
export function tessellate(doc: DxfDocument, options: TessellateOptions = {}): Tessellation {
  const curveSegments = options.curveSegments ?? DEFAULT_CURVE_SEGMENTS;
  const accumulators = new Map<string, Accumulator>();
  const layerColors = new Map<string, Map<number, number>>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let segmentCount = 0;

  const layerColor = (name: string): number => doc.layers.get(name)?.color ?? 0xffffff;

  // Resolve an entity's linetype dash pattern (entity → layer → continuous).
  // Text is never dashed (its glyph strokes should stay solid).
  const resolveDash = (entity: Entity, layer: string): number[] | null => {
    if (entity.type === "TEXT") return null;
    const name = entity.lineType ?? doc.layers.get(layer)?.lineType;
    if (!name) return null;
    const lt = doc.lineTypes.get(name);
    return lt && lt.pattern.length > 0 && lt.patternLength > 1e-9 ? lt.pattern : null;
  };

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
      const dashPattern = resolveDash(entity, layer);
      // OCS: entities carrying an extrusion normal (mirrored ARCs, POLYLINEs,
      // INSERTs) have OCS-relative coordinates — map them to world first.
      const entityTransform = entity.extrusion
        ? multiply(transform, ocsToWcs(entity.extrusion))
        : transform;

      const getAcc = (): Accumulator => {
        let acc = accumulators.get(layer);
        if (!acc) {
          acc = { positions: [], colors: [], fillPositions: [], fillColors: [] };
          accumulators.set(layer, acc);
        }
        return acc;
      };
      const countColor = (n: number): void => {
        let colorCounts = layerColors.get(layer);
        if (!colorCounts) {
          colorCounts = new Map();
          layerColors.set(layer, colorCounts);
        }
        colorCounts.set(color, (colorCounts.get(color) ?? 0) + n);
      };
      const r = ((color >> 16) & 0xff) / 255;
      const g = ((color >> 8) & 0xff) / 255;
      const b = (color & 0xff) / 255;
      const track = (x: number, y: number): void => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      };
      const tx = (p: Point2): [number, number] => [
        entityTransform[0] * p.x + entityTransform[2] * p.y + entityTransform[4],
        entityTransform[1] * p.x + entityTransform[3] * p.y + entityTransform[5],
      ];

      const ctx: TessellationContext = {
        curveSegments,
        addPolyline(points, closed = false) {
          if (points.length < 2) return;
          const acc = getAcc();

          const emit = (pts: Point2[], wrap: boolean): void => {
            const n = wrap ? pts.length : pts.length - 1;
            countColor(n);
            for (let i = 0; i < n; i++) {
              const [x1, y1] = tx(pts[i]);
              const [x2, y2] = tx(pts[(i + 1) % pts.length]);
              acc.positions.push(x1, y1, 0, x2, y2, 0);
              acc.colors.push(r, g, b, r, g, b);
              segmentCount += 1;
              track(x1, y1);
              track(x2, y2);
            }
          };

          if (dashPattern) {
            // Dash the full (corner-continuous) polyline; each drawn piece is
            // an open sub-polyline. Bounds still come from the drawn dashes.
            const full = closed ? [...points, points[0]] : points;
            for (const piece of dashPolyline(full, dashPattern)) emit(piece, false);
          } else {
            emit(points, closed);
          }
        },
        addFill(rings) {
          const tris = triangulate(rings);
          if (tris.length < 3) return;
          const acc = getAcc();
          countColor(tris.length / 3);
          for (const p of tris) {
            const [x, y] = tx(p);
            acc.fillPositions.push(x, y, 0);
            acc.fillColors.push(r, g, b);
            track(x, y);
          }
        },
        addBlock(blockName, local, insertLayer, insertColor) {
          if (depth >= MAX_INSERT_DEPTH) return;
          const block = doc.blocks.get(blockName);
          if (!block) return;
          const base: Affine = [1, 0, 0, 1, -block.basePoint.x, -block.basePoint.y];
          const combined = multiply(entityTransform, multiply(local, base));
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

  const recenter = (src: number[]): Float32Array => {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      out[i] = src[i] - offset.x;
      out[i + 1] = src[i + 1] - offset.y;
      out[i + 2] = 0;
    }
    return out;
  };

  const layers = new Map<string, LayerGeometry>();
  for (const [name, acc] of accumulators) {
    layers.set(name, {
      positions: recenter(acc.positions),
      colors: new Float32Array(acc.colors),
      fillPositions: recenter(acc.fillPositions),
      fillColors: new Float32Array(acc.fillColors),
    });
  }

  return { layers, bounds, offset, segmentCount, layerColors };
}
