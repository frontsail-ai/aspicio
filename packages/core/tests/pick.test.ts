import { expect, test } from "vite-plus/test";
import type { DxfDocument, Entity } from "../src/model/types.ts";
import { pickLayer } from "../src/pick/pick.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

function makeDoc(entities: Entity[]): DxfDocument {
  return {
    layers: new Map([
      ["A", { name: "A", color: 0xff0000, visible: true, frozen: false, entityCount: 0 }],
      ["B", { name: "B", color: 0x00ff00, visible: true, frozen: false, entityCount: 0 }],
    ]),
    entities,
    blocks: new Map(),
    lineTypes: new Map(),
    unsupported: {},
  };
}

const lineOn = (layer: string, y: number): Entity => ({
  type: "LINE",
  layer,
  color: null,
  start: { x: 0, y },
  end: { x: 10, y },
});

// Two horizontal lines: layer A at y=0, layer B at y=10.
// Tessellation offset re-centers to y ∈ [-5, +5].
const tess = tessellate(makeDoc([lineOn("A", 0), lineOn("B", 10)]));

test("picks the nearest layer within tolerance", () => {
  expect(pickLayer(tess, { x: 0, y: -4.5 }, 1)).toBe("A");
  expect(pickLayer(tess, { x: 0, y: 4.5 }, 1)).toBe("B");
});

test("returns null when nothing is within tolerance", () => {
  expect(pickLayer(tess, { x: 0, y: 0 }, 1)).toBeNull();
});

test("prefers the closest layer when both are in range", () => {
  expect(pickLayer(tess, { x: 5, y: -1 }, 100)).toBe("A");
  expect(pickLayer(tess, { x: 5, y: 1 }, 100)).toBe("B");
});

test("skips layers rejected by the predicate", () => {
  expect(pickLayer(tess, { x: 5, y: -4 }, 100, (name) => name !== "A")).toBe("B");
});

test("clamps to segment endpoints", () => {
  // Far beyond the right end of line A: distance is to endpoint (5,-5).
  expect(pickLayer(tess, { x: 6, y: -5 }, 1.5)).toBe("A");
  expect(pickLayer(tess, { x: 7, y: -5 }, 1.5)).toBeNull();
});

test("handles zero-length segments", () => {
  const dot = tessellate(
    makeDoc([
      {
        type: "LINE",
        layer: "A",
        color: null,
        start: { x: 3, y: 3 },
        end: { x: 3, y: 3 },
      },
    ]),
  );
  expect(pickLayer(dot, { x: 0, y: 0 }, 0.5)).toBe("A");
});
