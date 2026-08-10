import { countEntitiesByLayer } from "./layers.ts";
import type { DrawingDocument, Entity } from "./model/types.ts";
import {
  MODEL_SPACE,
  UnknownSpaceError,
  documentEntities,
  spaceEntities,
  spaceNames,
} from "./spaces.ts";
import { MAX_INSERT_DEPTH, tessellateSpace } from "./tessellate/tessellate.ts";
import type { TessellateOptions, Tessellation } from "./tessellate/tessellate.ts";

/** One layer's entry in a {@link DrawingSummary}. */
export interface LayerSummary {
  name: string;
  entityCount: number;
  visible: boolean;
  /** The color actually drawn on this layer (dominant), as `#rrggbb`. */
  color: string;
}

/** One space's own figures, so a multi-page or multi-sheet drawing can be
 *  navigated without describing it six times over. */
export interface SpaceSummary {
  /** Space name as {@link DescribeOptions.space} accepts it. */
  name: string;
  entityCount: number;
  segmentCount: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  size: { width: number; height: number } | null;
}

/** How much of a drawing to describe. */
export interface DescribeOptions extends TessellateOptions {
  /**
   * Describe one space instead of the whole drawing — "Model" (page 1 of a
   * PDF) or a layout/page name from {@link DrawingSummary.spaces}. The reply
   * is then scoped to it throughout, and matches what the viewer shows on that
   * tab. Omit for the whole drawing.
   */
  space?: string;
}

/**
 * A structured, JSON-friendly summary of a parsed drawing — what an agent or
 * HTTP API returns to describe a DXF without rendering it.
 */
export interface DrawingSummary {
  /** Which format produced this drawing ("dxf", "pdf"), or "" if unknown. */
  format: string;
  /** Drawing-unit label from `$INSUNITS` (e.g. "mm"), or "" when unitless. */
  units: string;
  /**
   * Which space this summary is scoped to, or null when it covers the whole
   * drawing. Geometry cannot be summed across spaces, so `bounds` and `size`
   * describe `spaces[0]` in that case — the same space `render` returns.
   */
  space: string | null;
  /** World-space extents, or null for an empty drawing. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Bounding-box size in drawing units, or null when empty. */
  size: { width: number; height: number } | null;
  entityCount: number;
  segmentCount: number;
  /**
   * Every space in the drawing, model space (a PDF's page 1) first, listed
   * whether or not this summary is scoped to one of them.
   *
   * These do not sum to `entityCount`: a DXF sheet's viewports re-show model
   * geometry, so an entity can be drawn in two spaces while existing once.
   */
  spaces: SpaceSummary[];
  /** Per-layer counts, on the same scope as `entityCount`; they sum to it. */
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

/** Collect unique text strings from `entities` and the blocks they reach. */
function collectTexts(doc: DrawingDocument, entities: readonly Entity[]): string[] {
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
  walk([...entities], 0);
  return out;
}

const boundsOf = (t: Tessellation): DrawingSummary["bounds"] =>
  t.bounds
    ? { minX: t.bounds.minX, minY: t.bounds.minY, maxX: t.bounds.maxX, maxY: t.bounds.maxY }
    : null;

const sizeOf = (t: Tessellation): DrawingSummary["size"] =>
  t.bounds ? { width: t.bounds.maxX - t.bounds.minX, height: t.bounds.maxY - t.bounds.minY } : null;

/**
 * Derive a structured {@link DrawingSummary} from a parsed document. Pure and
 * framework-free (no DOM/WebGL) — usable in Node and Cloudflare Workers. Layer
 * colors reflect what is actually drawn (entity overrides included), matching
 * the viewer.
 *
 * Covers the whole drawing by default — a six-page PDF reports six pages'
 * worth of entities, layers, and text, not page one's — and one space when
 * `options.space` names one, which is then the same view the viewer shows on
 * that tab (AGT-1).
 *
 * It tessellates every space to fill `spaces`, which costs a few percent of a
 * parse: on a 6-page prepress PDF, 36 ms of tessellation against 814 ms of
 * parsing.
 *
 * @throws UnknownSpaceError when `options.space` names no space in the drawing.
 */
export function describeDrawing(
  doc: DrawingDocument,
  options: DescribeOptions = {},
): DrawingSummary {
  const { space, ...tessellateOptions } = options;
  const names = spaceNames(doc);
  if (space !== undefined && !names.includes(space)) throw new UnknownSpaceError(space, names);

  const tessellations = new Map<string, Tessellation>();
  for (const name of names) tessellations.set(name, tessellateSpace(doc, name, tessellateOptions));

  const spaces: SpaceSummary[] = names.map((name) => {
    const t = tessellations.get(name)!;
    let entityCount = 0;
    for (const n of t.entityCounts.values()) entityCount += n;
    return {
      name,
      entityCount,
      segmentCount: t.segmentCount,
      bounds: boundsOf(t),
      size: sizeOf(t),
    };
  });

  // Scoped: one space's entities, its tessellation, its extents. Unscoped:
  // every entity once (which is not the concatenation of the spaces — see
  // `documentEntities`), and the first space's extents, because geometry from
  // different sheets shares no coordinate frame worth unioning.
  const scoped = space !== undefined;
  const entities = scoped ? spaceEntities(doc, space)! : documentEntities(doc);
  const geometry = tessellations.get(scoped ? space : MODEL_SPACE)!;
  const counts = countEntitiesByLayer(entities);

  const entityTypes: Record<string, number> = {};
  for (const entity of entities) entityTypes[entity.type] = (entityTypes[entity.type] ?? 0) + 1;

  const layers: LayerSummary[] = [...doc.layers.values()].map((layer) => ({
    name: layer.name,
    entityCount: counts.get(layer.name) ?? 0,
    visible: layer.visible,
    color: hex(effectiveColor(layer.name, layer.color, geometry)),
  }));

  return {
    format: doc.format ?? "",
    units: doc.units ?? "",
    space: scoped ? space : null,
    bounds: boundsOf(geometry),
    size: sizeOf(geometry),
    entityCount: entities.length,
    segmentCount: scoped ? geometry.segmentCount : spaces.reduce((n, s) => n + s.segmentCount, 0),
    spaces,
    layers,
    entityTypes,
    // Copied so the summary is a detached snapshot, not a live view.
    unsupported: { ...doc.unsupported },
    texts: collectTexts(doc, entities),
  };
}
