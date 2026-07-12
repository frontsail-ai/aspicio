import DxfParser from "dxf-parser";
import type { IBlock, IEntity, ILayer } from "dxf-parser";
import type { BlockDef, DxfDocument, Entity, LayerInfo, Point2, Point3 } from "../model/types.ts";

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

function convertEntity(raw: IEntity, unsupported: Record<string, number>): Entity | null {
  const base = { layer: raw.layer ?? "0", color: entityColor(raw) };
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
    default:
      unsupported[raw.type] = (unsupported[raw.type] ?? 0) + 1;
      return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Parse DXF text into the normalized Aspicio document model. */
export function parseDxf(text: string): DxfDocument {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error("Failed to parse DXF: parser returned no document");

  const unsupported: Record<string, number> = {};

  const layers = new Map<string, LayerInfo>();
  const rawLayers: Record<string, ILayer> = dxf.tables?.layer?.layers ?? {};
  for (const [name, layer] of Object.entries(rawLayers)) {
    layers.set(name, {
      name,
      color: typeof layer.color === "number" ? layer.color : DEFAULT_COLOR,
      visible: layer.visible !== false && layer.frozen !== true,
      frozen: layer.frozen === true,
      entityCount: 0,
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

  return { layers, entities, blocks, unsupported };
}
