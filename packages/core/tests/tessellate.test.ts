import { expect, test } from "vite-plus/test";
import type { BlockDef, DxfDocument } from "../src/model/types.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

function makeDoc(partial: Partial<DxfDocument>): DxfDocument {
  return {
    layers: new Map([
      ["0", { name: "0", color: 0xff0000, visible: true, frozen: false, entityCount: 0 }],
    ]),
    entities: [],
    blocks: new Map(),
    lineTypes: new Map(),
    unsupported: {},
    ...partial,
  };
}

test("line becomes one segment with layer color", () => {
  const doc = makeDoc({
    entities: [
      { type: "LINE", layer: "0", color: null, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    ],
  });
  const tess = tessellate(doc);
  expect(tess.segmentCount).toBe(1);
  expect(tess.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
  const layer = tess.layers.get("0");
  expect(layer?.positions).toHaveLength(6);
  // Positions are re-centered around the bounds center (offset 5,0).
  expect(layer?.positions[0]).toBe(-5);
  expect(layer?.positions[3]).toBe(5);
  // ByLayer color resolves to red.
  expect([...(layer?.colors.slice(0, 3) ?? [])]).toEqual([1, 0, 0]);
});

test("insert applies translate/rotate/scale to block entities", () => {
  const doc = makeDoc({
    entities: [
      {
        type: "INSERT",
        layer: "0",
        color: null,
        blockName: "B",
        position: { x: 100, y: 0 },
        scale: { x: 2, y: 2 },
        rotation: Math.PI / 2,
      },
    ],
    blocks: new Map<string, BlockDef>([
      [
        "B",
        {
          name: "B",
          basePoint: { x: 0, y: 0 },
          entities: [
            {
              type: "LINE",
              layer: "0",
              color: null,
              start: { x: 0, y: 0 },
              end: { x: 1, y: 0 },
            },
          ],
        },
      ],
    ]),
  });
  const tess = tessellate(doc);
  expect(tess.segmentCount).toBe(1);
  // (1,0) scaled ×2 → (2,0), rotated 90° → (0,2), translated → (100,2).
  expect(tess.bounds?.minX).toBeCloseTo(100);
  expect(tess.bounds?.maxY).toBeCloseTo(2);
});

test("closed polyline emits wrap-around segment", () => {
  const doc = makeDoc({
    entities: [
      {
        type: "POLYLINE",
        layer: "0",
        color: null,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        bulges: [0, 0, 0],
        closed: true,
      },
    ],
  });
  expect(tessellate(doc).segmentCount).toBe(3);
});
