import type { Entity, LayerInfo } from "./model/types.ts";

/**
 * A layer with no rendered entities — the LAYER-table entries (the default
 * "0", "Defpoints", …) that no drawn geometry references. `entityCount` is
 * scoped to one space (see {@link countEntitiesByLayer}), so a layer counts as
 * empty when the *active* space draws nothing on it — a sheet-only layer is
 * empty while model space is shown, and vice versa.
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

/**
 * Top-level entities per layer, for one space.
 *
 * The single definition of what an entity count *is*: every entity carries
 * exactly one layer, so each contributes 1 to exactly one bucket and the
 * buckets sum to `entities.length`. That is what keeps a layer panel's rows
 * and the total beside them two views of one number — they used to be
 * accumulated independently, and disagreed on any drawing with more than one
 * space.
 *
 * Block contents are not counted: an INSERT is one entity on its own layer,
 * however much geometry it expands into.
 */
export function countEntitiesByLayer(entities: readonly Entity[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entity of entities) counts.set(entity.layer, (counts.get(entity.layer) ?? 0) + 1);
  return counts;
}
