import type { LayerInfo } from "./model/types.ts";

/**
 * A layer with no rendered entities — the LAYER-table entries (the default
 * "0", "Defpoints", …) that no drawn geometry references. `entityCount` counts
 * only entities that tessellated, so this also covers layers whose entities
 * were all skipped (unsupported).
 *
 * The single definition lives here so every presentation surface — the demo
 * sidebar and the in-chat viewer widget — classifies layers the same way and
 * can't drift.
 */
export function isEmptyLayer(layer: LayerInfo): boolean {
  return layer.entityCount === 0;
}

/** Split layers into those with rendered geometry and the empty ones (see
 *  {@link isEmptyLayer}), preserving the original order within each group. */
export function partitionLayers(layers: readonly LayerInfo[]): {
  rendered: LayerInfo[];
  empty: LayerInfo[];
} {
  const rendered: LayerInfo[] = [];
  const empty: LayerInfo[] = [];
  for (const layer of layers) (isEmptyLayer(layer) ? empty : rendered).push(layer);
  return { rendered, empty };
}
