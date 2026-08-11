import { DEFAULT_CURVE_SEGMENTS, sampleArc, sampleBulge, sampleEllipse } from "../geom/arc.ts";
import { dashPolyline } from "../geom/dash.ts";
import { ocsToWcs } from "../geom/ocs.ts";
import { sampleSpline } from "../geom/spline.ts";
import { triangulate } from "../geom/triangulate.ts";
import { clipPolygon, clipSegment, viewportRect, viewportTransform } from "../geom/viewport.ts";
import { countEntitiesByLayer } from "../layers.ts";
import { MODEL_SPACE, UnknownSpaceError, layoutEntities, spaceNames } from "../spaces.ts";
import type { Rect } from "../geom/viewport.ts";
import type {
  Affine2D,
  Bounds,
  DrawingDocument,
  Entity,
  EntityType,
  Layout,
  PageGeometry,
  Point2,
  RasterImage,
} from "../model/types.ts";
import { darkenForLegibility } from "../geom/color.ts";
import { layoutText } from "../text/layout.ts";

type Affine = Affine2D;

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/**
 * Contrast a darkened pen colour must reach against the canvas.
 *
 * 3.5:1 rather than the 3:1 AA floor for non-text: line work at 3:1 sits
 * exactly on the boundary with nothing left for a thin hairline or a
 * miscalibrated display, and the extra step costs very little saturation.
 */
const CONTRAST_TARGET = 3.5;

/** Documents this never touches: PDF colours are ink, not pen assignments. */
const PDF_FORMAT = "pdf";
/** Block recursion bound, shared by rendering and text collection. */
export const MAX_INSERT_DEPTH = 16;

/**
 * A raster image placed in tessellation coordinates (the shared offset
 * already subtracted, like every position array).
 *
 * `transform` maps the unit square — (0,0) bottom-left, (1,1) top-right,
 * the image's top pixel row along v=1 — into recentered drawing space.
 * `corners` are the transformed unit-square corners (bl, br, tr, tl),
 * precomputed because every consumer (WebGL quad, SVG placement, bounds)
 * needs them.
 */
export interface PlacedImage {
  image: RasterImage;
  transform: Affine2D;
  corners: [Point2, Point2, Point2, Point2];
  /** Top-level entity index (parallels `segmentIds` / `fillIds`). */
  entityId: number;
}

/** Batched line-segment (and optional filled-triangle) geometry for one layer. */
export interface LayerGeometry {
  /** xyz triplets, two vertices per line segment. */
  positions: Float32Array;
  /** rgb (0..1) per line vertex. */
  colors: Float32Array;
  /** Lineweight in 1/100 mm, one value per segment (parallel to `positions`). */
  widths: Float32Array;
  /** Top-level entity index, one value per segment (parallel to `positions`). */
  segmentIds: Int32Array;
  /** xyz triplets, three vertices per filled triangle (SOLID, HATCH, …). */
  fillPositions: Float32Array;
  /** rgb (0..1) per fill vertex. */
  fillColors: Float32Array;
  /** Top-level entity index, one value per triangle (parallel to `fillPositions`). */
  fillIds: Int32Array;
  /** Raster images on this layer, in draw order (under fills and lines). */
  images: PlacedImage[];
}

export interface Tessellation {
  layers: Map<string, LayerGeometry>;
  bounds: Bounds | null;
  /** World-space offset subtracted from all positions (float precision guard). */
  offset: Point2;
  /** Total line segments emitted. */
  segmentCount: number;
  /** Total raster images placed. */
  imageCount: number;
  /**
   * Colors actually drawn per layer (24-bit RGB → segment count). Unlike the
   * layer-table color, this reflects per-entity overrides, ByBlock
   * inheritance, and block layer rules — what the viewer really shows.
   */
  layerColors: Map<string, Map<number, number>>;
  /**
   * Top-level entities per layer *in this space*, and nothing outside it.
   *
   * It rides on the tessellation because a tessellation is exactly one space:
   * a count read from here cannot have come from a different space than the
   * geometry beside it, which is how the panel's rows and the total above them
   * stay two views of one number. Summing the values gives the space's total.
   */
  entityCounts: Map<string, number>;
  /**
   * The space's paper, in tessellation coordinates (the shared `offset`
   * already subtracted, like every position array) — or null for an
   * unbounded space, which is every DXF space.
   *
   * It rides beside `layers` rather than in them on purpose: the sheet is
   * not a layer and must never behave like one. Everything that walks
   * `layers` — picking, snapping, the layer panel, per-layer visibility —
   * is therefore blind to it by construction rather than by a filter
   * somebody has to remember to write (VIEW-4, VIEW-7, VIEW-9).
   */
  backdrop: PageGeometry | null;
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
  /**
   * Place a raster image. `local` maps the unit square — (0,0) bottom-left,
   * top pixel row along v=1 — into entity-local coordinates; the walk
   * transform is applied on top.
   */
  addImage(image: RasterImage, local: Affine2D): void;
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

registerEntityHandler("IMAGE", (e, ctx) => {
  if (e.type !== "IMAGE") return;
  ctx.addImage(e.image, e.transform);
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
  widths: number[];
  segmentIds: number[];
  fillPositions: number[];
  fillColors: number[];
  fillIds: number[];
  /** Placed images with world-space transforms; recentered in finalize. */
  images: PlacedImage[];
}

export interface TessellateOptions {
  curveSegments?: number;
  /**
   * Keep line work legible against this canvas colour: pen colours are
   * darkened, hue intact, until they reach {@link CONTRAST_TARGET} against
   * it (VIEW-18). Omit — the default — to draw the colours the file names.
   *
   * Applies to DXF only. An ACI index is a display attribute, so remapping
   * it for a light canvas is the same kind of decision as picking its RGB
   * in the first place; PDF ink is not, and passing this never changes it.
   */
  legibleOn?: number;
  /**
   * The colour a pen darkens *towards* when it has no hue to preserve —
   * the theme's ink. Only consulted alongside `legibleOn`; defaults to
   * black, which is legible but colder than a warm palette's near-black.
   */
  ink?: number;
}

interface Tessellator {
  /**
   * Accumulate an entity list. `clip` (paper-space rect) is set only for a
   * viewport's model content, which is transformed into paper coords and
   * clipped to the window.
   */
  walk(
    entities: Entity[],
    transform: Affine,
    layerOverride: string | null,
    colorOverride: number | null,
    depth: number,
    widthOverride: number | null,
    entityIdOverride: number | null,
    clip: Rect | null,
  ): void;
  /** Give the space its paper, before finalizing. Null leaves it unbounded. */
  setPage(page: PageGeometry | null): void;
  /**
   * Everything but `entityCounts`, which the space entry points add: only they
   * know which entity lists make up the space (a sheet's own geometry plus
   * whatever its windows borrow from model space).
   */
  finalize(): Omit<Tessellation, "entityCounts">;
}

function createTessellator(doc: DrawingDocument, options: TessellateOptions): Tessellator {
  const curveSegments = options.curveSegments ?? DEFAULT_CURVE_SEGMENTS;
  const accumulators = new Map<string, Accumulator>();
  const layerColors = new Map<string, Map<number, number>>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let segmentCount = 0;
  let imageCount = 0;

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

  // Resolve a lineweight in 1/100 mm (entity → block override → layer → 0).
  // 0 means "hairline" — the renderer draws it as a thin 1px line.
  const resolveWidth = (entity: Entity, layer: string, override: number | null): number => {
    if (entity.lineWeight !== undefined && entity.lineWeight >= 0) return entity.lineWeight;
    if (override !== null) return override;
    const lw = doc.layers.get(layer)?.lineWeight;
    return lw !== undefined && lw >= 0 ? lw : 0;
  };

  function walk(
    entities: Entity[],
    transform: Affine,
    layerOverride: string | null,
    colorOverride: number | null,
    depth: number,
    widthOverride: number | null,
    entityIdOverride: number | null,
    clip: Rect | null,
  ): void {
    for (let idx = 0; idx < entities.length; idx++) {
      const entity = entities[idx];
      // Every segment/triangle carries the index of the top-level entity it
      // belongs to, so a screen pick maps back to `document.entities[id]`.
      const entityId = entityIdOverride ?? idx;
      // CAD rule: block entities on layer "0" belong to the insert's layer.
      const layer = layerOverride !== null && entity.layer === "0" ? layerOverride : entity.layer;
      const color = legible(entity.color ?? colorOverride ?? layerColor(layer));
      const dashPattern = resolveDash(entity, layer);
      const weight = resolveWidth(entity, layer, widthOverride);
      // OCS: entities carrying an extrusion normal (mirrored ARCs, POLYLINEs,
      // INSERTs) have OCS-relative coordinates — map them to world first.
      const entityTransform = entity.extrusion
        ? multiply(transform, ocsToWcs(entity.extrusion))
        : transform;

      const getAcc = (): Accumulator => {
        let acc = accumulators.get(layer);
        if (!acc) {
          acc = {
            positions: [],
            colors: [],
            widths: [],
            segmentIds: [],
            fillPositions: [],
            fillColors: [],
            fillIds: [],
            images: [],
          };
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
      const ptOf = ([x, y]: [number, number]): Point2 => ({ x, y });

      const ctx: TessellationContext = {
        curveSegments,
        addPolyline(points, closed = false) {
          if (points.length < 2) return;
          const acc = getAcc();

          const emit = (pts: Point2[], wrap: boolean): void => {
            const n = wrap ? pts.length : pts.length - 1;
            for (let i = 0; i < n; i++) {
              const [ax, ay] = tx(pts[i]);
              const [bx, by] = tx(pts[(i + 1) % pts.length]);
              let x1 = ax;
              let y1 = ay;
              let x2 = bx;
              let y2 = by;
              if (clip) {
                const seg = clipSegment({ x: ax, y: ay }, { x: bx, y: by }, clip);
                if (!seg) continue;
                x1 = seg[0].x;
                y1 = seg[0].y;
                x2 = seg[1].x;
                y2 = seg[1].y;
              }
              acc.positions.push(x1, y1, 0, x2, y2, 0);
              acc.colors.push(r, g, b, r, g, b);
              acc.widths.push(weight);
              acc.segmentIds.push(entityId);
              countColor(1);
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
          // With a clip, transform rings to paper coords and clip each to the
          // window before triangulating; otherwise triangulate then transform.
          const tris = clip
            ? triangulate(
                rings
                  .map((ring) =>
                    clipPolygon(
                      ring.map((p) => ptOf(tx(p))),
                      clip,
                    ),
                  )
                  .filter((ring) => ring.length >= 3),
              )
            : triangulate(rings);
          if (tris.length < 3) return;
          const acc = getAcc();
          countColor(tris.length / 3);
          for (let i = 0; i < tris.length; i++) {
            const [x, y] = clip ? [tris[i].x, tris[i].y] : tx(tris[i]);
            acc.fillPositions.push(x, y, 0);
            acc.fillColors.push(r, g, b);
            if (i % 3 === 0) acc.fillIds.push(entityId);
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
            weight > 0 ? weight : widthOverride,
            entityId,
            clip,
          );
        },
        addImage(image, local) {
          // Viewport-framed model content would need quad clipping plus UV
          // rework; no current producer emits images there, so skip (PDF
          // pages carry no viewports).
          if (clip) return;
          const m = multiply(entityTransform, local);
          const corner = (u: number, v: number): Point2 => ({
            x: m[0] * u + m[2] * v + m[4],
            y: m[1] * u + m[3] * v + m[5],
          });
          const corners: [Point2, Point2, Point2, Point2] = [
            corner(0, 0),
            corner(1, 0),
            corner(1, 1),
            corner(0, 1),
          ];
          for (const p of corners) track(p.x, p.y);
          getAcc().images.push({ image, transform: m, corners, entityId });
          imageCount += 1;
        },
      };

      handlers.get(entity.type)?.(entity, ctx);
    }
  }

  /**
   * Pen colours darkened for a light canvas, or identity.
   *
   * Keyed off the document's format rather than a caller flag, so no surface
   * can accidentally apply it to ink. `!== "pdf"` and not `=== "dxf"`: the
   * DXF parser does not stamp a format, and hand-built documents may carry
   * none, so equality would silently skip exactly the documents this exists
   * for. Memoised because a drawing has few distinct colours and many
   * entities.
   */
  const canvas = doc.format === PDF_FORMAT ? undefined : options.legibleOn;
  const legibleCache = new Map<number, number>();
  const legible =
    canvas === undefined
      ? (color: number): number => color
      : (color: number): number => {
          let out = legibleCache.get(color);
          if (out === undefined) {
            out = darkenForLegibility(color, canvas, CONTRAST_TARGET, options.ink ?? 0x000000);
            legibleCache.set(color, out);
          }
          return out;
        };

  let page: PageGeometry | null = null;

  const setPage = (p: PageGeometry | null): void => {
    page = p;
    if (!p) return;
    // The sheet joins the bounds, so a fit frames the paper rather than the
    // ink on it (VIEW-2). A logo in one corner of an A4 page opens showing
    // the page, which is what Acrobat and Preview do and what a reader
    // expects; framing the artwork instead hides that a page exists at all.
    minX = Math.min(minX, p.sheet.minX);
    minY = Math.min(minY, p.sheet.minY);
    maxX = Math.max(maxX, p.sheet.maxX);
    maxY = Math.max(maxY, p.sheet.maxY);
  };

  const finalize = (): Omit<Tessellation, "entityCounts"> => {
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

    const recenterImage = (img: PlacedImage): PlacedImage => ({
      ...img,
      transform: [
        img.transform[0],
        img.transform[1],
        img.transform[2],
        img.transform[3],
        img.transform[4] - offset.x,
        img.transform[5] - offset.y,
      ],
      corners: img.corners.map((p) => ({ x: p.x - offset.x, y: p.y - offset.y })) as [
        Point2,
        Point2,
        Point2,
        Point2,
      ],
    });

    const layers = new Map<string, LayerGeometry>();
    for (const [name, acc] of accumulators) {
      layers.set(name, {
        positions: recenter(acc.positions),
        colors: new Float32Array(acc.colors),
        widths: new Float32Array(acc.widths),
        segmentIds: Int32Array.from(acc.segmentIds),
        fillPositions: recenter(acc.fillPositions),
        fillColors: new Float32Array(acc.fillColors),
        fillIds: Int32Array.from(acc.fillIds),
        images: acc.images.map(recenterImage),
      });
    }

    const shift = (b: Bounds): Bounds => ({
      minX: b.minX - offset.x,
      minY: b.minY - offset.y,
      maxX: b.maxX - offset.x,
      maxY: b.maxY - offset.y,
    });
    const backdrop: PageGeometry | null = page
      ? {
          sheet: shift(page.sheet),
          ...(page.trim ? { trim: shift(page.trim) } : {}),
          ...(page.bleed ? { bleed: shift(page.bleed) } : {}),
        }
      : null;

    return { layers, bounds, offset, segmentCount, imageCount, layerColors, backdrop };
  };

  return { walk, setPage, finalize };
}

/** Tessellate a document's model space into per-layer batched geometry. */
export function tessellate(doc: DrawingDocument, options: TessellateOptions = {}): Tessellation {
  const t = createTessellator(doc, options);
  t.setPage(doc.page ?? null);
  t.walk(doc.entities, IDENTITY, null, null, 0, null, null, null);
  return { ...t.finalize(), entityCounts: countEntitiesByLayer(doc.entities) };
}

/**
 * Tessellate a space by name — model space when `name` is omitted or
 * {@link MODEL_SPACE}, otherwise the layout that carries it.
 *
 * Every caller that renders or describes goes through here, so "which space"
 * is decided once rather than re-decided at each call site. It used to be
 * re-decided at ten of them, every one hardcoding model space, which is why no
 * agent surface could reach page 2 of a PDF.
 *
 * @throws UnknownSpaceError for a name the drawing does not have. The viewer
 * does not come through here — it ignores unknown names (VIEW-14) — so nothing
 * is served by a silent fallback that would quietly render the wrong sheet.
 */
export function tessellateSpace(
  doc: DrawingDocument,
  name?: string,
  options: TessellateOptions = {},
): Tessellation {
  if (name === undefined || name === MODEL_SPACE) return tessellate(doc, options);
  const layout = doc.layouts?.find((l) => l.name === name);
  if (!layout) throw new UnknownSpaceError(name, spaceNames(doc));
  return tessellateLayout(doc, layout, options);
}

/**
 * Tessellate a paper-space layout: its own geometry in paper coordinates,
 * plus each viewport's model content transformed into paper coords and
 * clipped to the window. Everything is baked into one paper-space
 * tessellation, so the renderer needs no viewport awareness.
 */
export function tessellateLayout(
  doc: DrawingDocument,
  layout: Layout,
  options: TessellateOptions = {},
): Tessellation {
  const t = createTessellator(doc, options);
  t.setPage(layout.page ?? null);
  t.walk(layout.entities, IDENTITY, null, null, 0, null, null, null);
  for (const vp of layout.viewports) {
    t.walk(doc.entities, viewportTransform(vp), null, null, 0, null, null, viewportRect(vp));
  }
  return { ...t.finalize(), entityCounts: countEntitiesByLayer(layoutEntities(doc, layout)) };
}
