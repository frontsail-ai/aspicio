import { expect, test } from "vite-plus/test";
import { isEmptyLayer, partitionLayers } from "../src/layers.ts";
import type { LayerInfo } from "../src/model/types.ts";

const layer = (name: string, entityCount: number): LayerInfo => ({
  name,
  color: 0xffffff,
  visible: true,
  frozen: false,
  entityCount,
});

test("isEmptyLayer is true exactly when nothing rendered on the layer", () => {
  expect(isEmptyLayer(layer("0", 0))).toBe(true);
  expect(isEmptyLayer(layer("WALLS", 5))).toBe(false);
});

test("partitionLayers splits by geometry, preserving order", () => {
  const input = [layer("WALLS", 5), layer("0", 0), layer("DOORS", 3), layer("Defpoints", 0)];
  const { rendered, empty } = partitionLayers(input);
  expect(rendered.map((l) => l.name)).toEqual(["WALLS", "DOORS"]);
  expect(empty.map((l) => l.name)).toEqual(["0", "Defpoints"]);
});

test("partitionLayers returns empties as [] when every layer has geometry", () => {
  const { rendered, empty } = partitionLayers([layer("A", 1), layer("B", 2)]);
  expect(rendered).toHaveLength(2);
  expect(empty).toEqual([]);
});
