import type { DxfDocument, Entity } from "./model/types.ts";
import { MAX_INSERT_DEPTH } from "./tessellate/tessellate.ts";
import type { Tessellation } from "./tessellate/tessellate.ts";

/** One layer's entry in a {@link DrawingSummary}. */
export interface LayerSummary {
  name: string;
  entityCount: number;
  visible: boolean;
  /** The color actually drawn on this layer (dominant), as `#rrggbb`. */
  color: string;
}

/**
 * A structured, JSON-friendly summary of a parsed drawing — what an agent or
 * HTTP API returns to describe a DXF without rendering it.
 */
export interface DrawingSummary {
  /** Drawing-unit label from `$INSUNITS` (e.g. "mm"), or "" when unitless. */
  units: string;
  /** World-space extents, or null for an empty drawing. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Bounding-box size in drawing units, or null when empty. */
  size: { width: number; height: number } | null;
  entityCount: number;
  segmentCount: number;
  layers: LayerSummary[];
  /** Top-level entities per DXF type, e.g. `{ LINE: 12, CIRCLE: 3 }`. */
  entityTypes: Record<string, number>;
  /** Per-type counts of entities the parser skipped (unsupported types). */
  unsupported: Record<string, number>;
  /**
   * Unique TEXT/MTEXT strings in first-appearance order, including text
   * inside blocks reachable through INSERTs and DIMENSIONs (where title
   * blocks and dimension values live). Repeated inserts contribute once.
   */
  texts: string[];
}

const hex = (rgb: number): string => `#${(rgb >>> 0).toString(16).padStart(6, "0").slice(-6)}`;

/** Dominant color actually drawn on a layer, falling back to the table color. */
function effectiveColor(name: string, fallback: number, tessellation: Tessellation): number {
  const counts = tessellation.layerColors.get(name);
  if (!counts || counts.size === 0) return fallback;
  let best = fallback;
  let bestCount = -1;
  for (const [color, count] of counts) {
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

/** Collect unique text strings from entities and reachable blocks. */
function collectTexts(doc: DxfDocument): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const visitedBlocks = new Set<string>();
  const walk = (entities: Entity[], depth: number): void => {
    // Same recursion bound tessellation uses, so the summary never reports
    // text from deeper than the renderer would draw — and a crafted long
    // INSERT chain can't overflow the stack.
    if (depth >= MAX_INSERT_DEPTH) return;
    for (const entity of entities) {
      if (entity.type === "TEXT" && entity.text) {
        if (!seen.has(entity.text)) {
          seen.add(entity.text);
          out.push(entity.text);
        }
      } else if (entity.type === "INSERT" || entity.type === "DIMENSION") {
        const name = entity.type === "INSERT" ? entity.blockName : entity.block;
        if (visitedBlocks.has(name)) continue;
        visitedBlocks.add(name);
        const block = doc.blocks.get(name);
        if (block) walk(block.entities, depth + 1);
      }
    }
  };
  walk(doc.entities, 0);
  return out;
}

/**
 * Derive a structured {@link DrawingSummary} from a parsed document and its
 * tessellation. Pure and framework-free (no DOM/WebGL) — usable in Node and
 * Cloudflare Workers. Layer colors reflect what is actually drawn (entity
 * overrides included), matching the viewer.
 */
export function describeDrawing(doc: DxfDocument, tessellation: Tessellation): DrawingSummary {
  const entityTypes: Record<string, number> = {};
  for (const entity of doc.entities) {
    entityTypes[entity.type] = (entityTypes[entity.type] ?? 0) + 1;
  }

  const layers: LayerSummary[] = [...doc.layers.values()].map((layer) => ({
    name: layer.name,
    entityCount: layer.entityCount,
    visible: layer.visible,
    color: hex(effectiveColor(layer.name, layer.color, tessellation)),
  }));

  const b = tessellation.bounds;
  return {
    units: doc.units ?? "",
    bounds: b ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } : null,
    size: b ? { width: b.maxX - b.minX, height: b.maxY - b.minY } : null,
    entityCount: doc.entities.length,
    segmentCount: tessellation.segmentCount,
    layers,
    entityTypes,
    // Copied so the summary is a detached snapshot, not a live view.
    unsupported: { ...doc.unsupported },
    texts: collectTexts(doc),
  };
}
