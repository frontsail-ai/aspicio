import DxfParser from "dxf-parser";
import type { IBlock, IEntity, ILayer } from "dxf-parser";
import { DEFAULT_CURVE_SEGMENTS, sampleArc, sampleBulge } from "../geom/arc.ts";
import type {
  BlockDef,
  DxfDocument,
  Entity,
  HatchEntity,
  LayerInfo,
  LineTypeDef,
  Point2,
  Point3,
  TextHAlign,
  TextVAlign,
} from "../model/types.ts";
import { stripMText } from "../text/layout.ts";
import { HatchHandler } from "./hatch.ts";
import type { HatchBoundary, RawHatchEntity } from "./hatch.ts";

const DEG2RAD = Math.PI / 180;
const DEFAULT_COLOR = 0xffffff;

function point2(p: { x?: number; y?: number } | undefined): Point2 {
  return { x: p?.x ?? 0, y: p?.y ?? 0 };
}

/** Entity color: explicit RGB, or null meaning ByLayer/ByBlock. */
function entityColor(raw: IEntity): number | null {
  // colorIndex 256 = ByLayer, 0 = ByBlock; dxf-parser leaves `color`
  // undefined when code 62 is absent (implicit ByLayer).
  if (raw.colorIndex === 0 || raw.colorIndex === 256) return null;
  return typeof raw.color === "number" ? raw.color : null;
}

/** Linetype name, or undefined for ByLayer/continuous. */
function lineTypeOf(raw: IEntity): string | undefined {
  const name = (raw as { lineType?: string }).lineType;
  if (!name || name === "ByLayer" || name === "BYLAYER") return undefined;
  return name;
}

/**
 * Lineweight in 1/100 mm (group 370), or undefined for the negative
 * ByLayer/ByBlock/default codes (so the layer default applies).
 */
function lineWeightOf(raw: { lineweight?: number }): number | undefined {
  const w = raw.lineweight;
  return typeof w === "number" && w >= 0 ? w : undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- raw parser entities are shape-checked per type */

/**
 * OCS extrusion normal, or undefined for the default +Z. dxf-parser exposes
 * it as separate fields (ARC, LWPOLYLINE) or a point (POLYLINE, INSERT).
 * Note: dxf-parser does not parse 210 codes for CIRCLE — mirrored circles
 * keep an unmirrored center until that upstream gap is fixed.
 */
function extrusionOf(e: any): Point3 | undefined {
  const x: number = e.extrusionDirectionX ?? e.extrusionDirection?.x ?? 0;
  const y: number = e.extrusionDirectionY ?? e.extrusionDirection?.y ?? 0;
  const z: number = e.extrusionDirectionZ ?? e.extrusionDirection?.z ?? 1;
  if (x === 0 && y === 0 && z === 1) return undefined;
  return { x, y, z };
}

function textHAlign(halign: number): TextHAlign {
  if (halign === 1 || halign === 4) return "center";
  if (halign === 2) return "right";
  return "left";
}

function textVAlign(valign: number): TextVAlign {
  if (valign === 1) return "bottom";
  if (valign === 2) return "middle";
  if (valign === 3) return "top";
  return "baseline";
}

function convertEntity(raw: IEntity, unsupported: Record<string, number>): Entity | null {
  const base = {
    layer: raw.layer ?? "0",
    color: entityColor(raw),
    lineType: lineTypeOf(raw),
    lineWeight: lineWeightOf(raw as { lineweight?: number }),
  };
  const e = raw as any;
  switch (raw.type) {
    case "LINE": {
      const v = e.vertices ?? [];
      if (v.length < 2) return null;
      return { ...base, type: "LINE", start: point2(v[0]), end: point2(v[1]) };
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      const v = e.vertices ?? [];
      if (v.length < 2) return null;
      return {
        ...base,
        type: "POLYLINE",
        extrusion: extrusionOf(e),
        points: v.map(point2),
        bulges: v.map((p: { bulge?: number }) => p.bulge ?? 0),
        closed: e.shape === true,
      };
    }
    case "CIRCLE":
      return { ...base, type: "CIRCLE", center: point2(e.center), radius: e.radius ?? 0 };
    case "ARC":
      return {
        ...base,
        type: "ARC",
        extrusion: extrusionOf(e),
        center: point2(e.center),
        radius: e.radius ?? 0,
        startAngle: e.startAngle ?? 0,
        endAngle: e.endAngle ?? 0,
      };
    case "ELLIPSE":
      return {
        ...base,
        type: "ELLIPSE",
        center: point2(e.center),
        majorAxis: point2(e.majorAxisEndPoint),
        axisRatio: e.axisRatio ?? 1,
        startParam: e.startAngle ?? 0,
        endParam: e.endAngle ?? 2 * Math.PI,
      };
    case "INSERT":
      if (!e.name) return null;
      return {
        ...base,
        type: "INSERT",
        extrusion: extrusionOf(e),
        blockName: e.name,
        position: point2(e.position),
        scale: { x: e.xScale ?? 1, y: e.yScale ?? 1 },
        rotation: (e.rotation ?? 0) * DEG2RAD,
      };
    case "TEXT": {
      const text: string = e.text ?? "";
      if (!text) return null;
      const halign = e.halign ?? 0;
      const valign = e.valign ?? 0;
      const aligned = halign !== 0 || valign !== 0;
      const position = aligned && e.endPoint ? point2(e.endPoint) : point2(e.startPoint);
      return {
        ...base,
        type: "TEXT",
        position,
        text,
        height: e.textHeight ?? 1,
        rotation: (e.rotation ?? 0) * DEG2RAD,
        widthFactor: e.xScale ?? 1,
        hAlign: textHAlign(halign),
        vAlign: textVAlign(valign),
      };
    }
    case "MTEXT": {
      const text = stripMText(e.text ?? "");
      if (!text) return null;
      const ap: number = e.attachmentPoint ?? 1;
      const hCol = (ap - 1) % 3; // 0 left, 1 center, 2 right
      const vRow = Math.floor((ap - 1) / 3); // 0 top, 1 middle, 2 bottom
      const rotation =
        typeof e.rotation === "number"
          ? e.rotation * DEG2RAD
          : e.directionVector
            ? Math.atan2(e.directionVector.y ?? 0, e.directionVector.x ?? 1)
            : 0;
      return {
        ...base,
        type: "TEXT",
        position: point2(e.position),
        text,
        height: e.height ?? 1,
        rotation,
        widthFactor: 1,
        hAlign: hCol === 1 ? "center" : hCol === 2 ? "right" : "left",
        vAlign: vRow === 0 ? "top" : vRow === 1 ? "middle" : "bottom",
      };
    }
    case "SPLINE": {
      const controlPoints: Point2[] = (e.controlPoints ?? []).map(point2);
      if (controlPoints.length < 2) return null;
      return {
        ...base,
        type: "SPLINE",
        controlPoints,
        knots: Array.isArray(e.knotValues) ? e.knotValues : [],
        degree: e.degreeOfSplineCurve ?? 3,
        closed: e.closed === true,
      };
    }
    case "SOLID":
    case "TRACE": {
      const pts: Point2[] = (e.points ?? []).map(point2);
      if (pts.length < 3) return null;
      // DXF SOLID/TRACE order is 0,1,3,2 — reorder to a simple ring.
      const points = pts.length >= 4 ? [pts[0], pts[1], pts[3], pts[2]] : pts;
      return { ...base, type: "SOLID", points };
    }
    case "3DFACE": {
      const v: Point2[] = (e.vertices ?? []).map(point2);
      if (v.length < 3) return null;
      return { ...base, type: "SOLID", points: v };
    }
    case "POINT":
      return { ...base, type: "POINT", position: point2(e.position) };
    case "HATCH":
      return convertHatch(raw as unknown as RawHatchEntity, base);
    case "DIMENSION": {
      if (!e.block) return null;
      return {
        ...base,
        type: "DIMENSION",
        block: e.block,
        position: point2(e.anchorPoint ?? e.insertionPoint),
      };
    }
    default:
      unsupported[raw.type] = (unsupported[raw.type] ?? 0) + 1;
      return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type EntityBaseFields = {
  layer: string;
  color: number | null;
  lineType?: string;
  lineWeight?: number;
};

/** Sample one HATCH boundary loop into a closed polyline. */
function sampleBoundary(b: HatchBoundary): Point2[] {
  if (b.kind === "polyline") {
    const v = b.vertices;
    if (v.length < 2) return [];
    const out: Point2[] = [v[0]];
    const last = b.closed ? v.length : v.length - 1;
    for (let i = 0; i < last; i++) {
      const p1 = v[i];
      const p2 = v[(i + 1) % v.length];
      if (p1.bulge) out.push(...sampleBulge(p1, p2, p1.bulge, DEFAULT_CURVE_SEGMENTS));
      else out.push(p2);
    }
    return out;
  }
  const out: Point2[] = [];
  for (const e of b.edges) {
    if (e.type === "line") {
      out.push({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });
    } else {
      let sweep = e.end - e.start;
      if (!e.ccw) sweep = -Math.abs(sweep === 0 ? 2 * Math.PI : sweep);
      else if (sweep <= 1e-9) sweep += 2 * Math.PI;
      out.push(...sampleArc(e.cx, e.cy, e.radius, e.start, sweep, DEFAULT_CURVE_SEGMENTS));
    }
  }
  return out;
}

function convertHatch(raw: RawHatchEntity, base: EntityBaseFields): HatchEntity | null {
  const loops = raw.boundaries.map(sampleBoundary).filter((loop) => loop.length >= 3);
  if (loops.length === 0) return null;
  return { ...base, type: "HATCH", loops, solid: raw.solid };
}

function parseLineTypes(dxf: {
  tables?: { lineType?: { lineTypes?: Record<string, unknown> } };
}): Map<string, LineTypeDef> {
  const map = new Map<string, LineTypeDef>();
  const raw = dxf.tables?.lineType?.lineTypes ?? {};
  for (const [name, def] of Object.entries(raw)) {
    const pattern: number[] = ((def as { pattern?: unknown[] }).pattern ?? [])
      .map((n) => (typeof n === "number" ? n : Number(n)))
      .filter((n) => Number.isFinite(n));
    const patternLength = pattern.reduce((sum, n) => sum + Math.abs(n), 0);
    map.set(name, { name, pattern, patternLength });
  }
  return map;
}

/** Parse DXF text into the normalized Aspicio document model. */
export function parseDxf(text: string): DxfDocument {
  const parser = new DxfParser();
  // dxf-parser has no built-in HATCH handler; register our own.
  (parser as { registerEntityHandler(h: unknown): void }).registerEntityHandler(HatchHandler);
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error("Failed to parse DXF: parser returned no document");

  const unsupported: Record<string, number> = {};
  const lineTypes = parseLineTypes(dxf);

  const layers = new Map<string, LayerInfo>();
  const rawLayers: Record<string, ILayer> = dxf.tables?.layer?.layers ?? {};
  for (const [name, layer] of Object.entries(rawLayers)) {
    layers.set(name, {
      name,
      color: typeof layer.color === "number" ? layer.color : DEFAULT_COLOR,
      visible: layer.visible !== false && layer.frozen !== true,
      frozen: layer.frozen === true,
      entityCount: 0,
      lineType: (layer as { lineType?: string }).lineType,
      lineWeight: lineWeightOf(layer as { lineweight?: number }),
    });
  }

  const ensureLayer = (name: string): LayerInfo => {
    let layer = layers.get(name);
    if (!layer) {
      layer = { name, color: DEFAULT_COLOR, visible: true, frozen: false, entityCount: 0 };
      layers.set(name, layer);
    }
    return layer;
  };

  const entities: Entity[] = [];
  for (const raw of dxf.entities ?? []) {
    const entity = convertEntity(raw, unsupported);
    if (!entity) continue;
    ensureLayer(entity.layer).entityCount += 1;
    entities.push(entity);
  }

  const blocks = new Map<string, BlockDef>();
  const rawBlocks: Record<string, IBlock> = dxf.blocks ?? {};
  for (const [name, block] of Object.entries(rawBlocks)) {
    const blockEntities: Entity[] = [];
    for (const raw of block.entities ?? []) {
      const entity = convertEntity(raw, unsupported);
      if (entity) {
        ensureLayer(entity.layer);
        blockEntities.push(entity);
      }
    }
    blocks.set(name, { name, basePoint: point2(block.position), entities: blockEntities });
  }

  return { layers, entities, blocks, lineTypes, unsupported };
}
