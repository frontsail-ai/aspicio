import { expect, test } from "vite-plus/test";
import type { BlockDef, DxfDocument, Entity } from "../src/model/types.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

function makeDoc(
  entities: Entity[],
  blocks: [string, BlockDef][] = [],
  layers?: Map<string, DxfDocument["layers"] extends Map<string, infer V> ? V : never>,
): DxfDocument {
  return {
    layers:
      layers ??
      new Map([
        ["0", { name: "0", color: 0xffffff, visible: true, frozen: false, entityCount: 0 }],
        ["A", { name: "A", color: 0x00ff00, visible: true, frozen: false, entityCount: 0 }],
      ]),
    entities,
    blocks: new Map(blocks),
    unsupported: {},
  };
}

const line = (over: Partial<Entity> = {}): Entity =>
  ({
    type: "LINE",
    layer: "0",
    color: null,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    ...over,
  }) as Entity;

test("empty document produces null bounds and zero offset", () => {
  const tess = tessellate(makeDoc([]));
  expect(tess.bounds).toBeNull();
  expect(tess.offset).toEqual({ x: 0, y: 0 });
  expect(tess.segmentCount).toBe(0);
  expect(tess.layers.size).toBe(0);
});

test("INSERT of a missing block emits nothing", () => {
  const tess = tessellate(
    makeDoc([
      {
        type: "INSERT",
        layer: "0",
        color: null,
        blockName: "NOPE",
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      },
    ]),
  );
  expect(tess.segmentCount).toBe(0);
});

test("self-referencing block terminates at the depth limit", () => {
  const selfInsert: Entity = {
    type: "INSERT",
    layer: "0",
    color: null,
    blockName: "LOOP",
    position: { x: 1, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  };
  const block: BlockDef = {
    name: "LOOP",
    basePoint: { x: 0, y: 0 },
    entities: [line(), selfInsert],
  };
  const tess = tessellate(makeDoc([selfInsert], [["LOOP", block]]));
  // One line per recursion level, capped by MAX_INSERT_DEPTH (16).
  expect(tess.segmentCount).toBe(16);
});

test("block entities on layer 0 inherit the insert's layer", () => {
  const block: BlockDef = { name: "B", basePoint: { x: 0, y: 0 }, entities: [line()] };
  const tess = tessellate(
    makeDoc(
      [
        {
          type: "INSERT",
          layer: "A",
          color: null,
          blockName: "B",
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
        },
      ],
      [["B", block]],
    ),
  );
  expect([...tess.layers.keys()]).toEqual(["A"]);
  // ...and pick up the insert layer's color (green).
  expect([...(tess.layers.get("A")?.colors.slice(0, 3) ?? [])]).toEqual([0, 1, 0]);
});

test("block entities on their own layer keep it", () => {
  const block: BlockDef = {
    name: "B",
    basePoint: { x: 0, y: 0 },
    entities: [line({ layer: "A" })],
  };
  const tess = tessellate(
    makeDoc(
      [
        {
          type: "INSERT",
          layer: "0",
          color: null,
          blockName: "B",
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
        },
      ],
      [["B", block]],
    ),
  );
  expect([...tess.layers.keys()]).toEqual(["A"]);
});

test("ByBlock entities inherit the insert's explicit color", () => {
  const block: BlockDef = { name: "B", basePoint: { x: 0, y: 0 }, entities: [line()] };
  const tess = tessellate(
    makeDoc(
      [
        {
          type: "INSERT",
          layer: "0",
          color: 0x0000ff,
          blockName: "B",
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
        },
      ],
      [["B", block]],
    ),
  );
  expect([...(tess.layers.get("0")?.colors.slice(0, 3) ?? [])]).toEqual([0, 0, 1]);
});

test("block base point is subtracted before the insert transform", () => {
  const block: BlockDef = {
    name: "B",
    basePoint: { x: 10, y: 10 },
    entities: [line({ start: { x: 10, y: 10 }, end: { x: 11, y: 10 } } as Partial<Entity>)],
  };
  const tess = tessellate(
    makeDoc(
      [
        {
          type: "INSERT",
          layer: "0",
          color: null,
          blockName: "B",
          position: { x: 100, y: 100 },
          scale: { x: 1, y: 1 },
          rotation: 0,
        },
      ],
      [["B", block]],
    ),
  );
  expect(tess.bounds?.minX).toBeCloseTo(100);
  expect(tess.bounds?.maxX).toBeCloseTo(101);
  expect(tess.bounds?.minY).toBeCloseTo(100);
});

test("ARC with endAngle < startAngle wraps a full turn", () => {
  const tess = tessellate(
    makeDoc([
      {
        type: "ARC",
        layer: "0",
        color: null,
        center: { x: 0, y: 0 },
        radius: 1,
        startAngle: Math.PI,
        endAngle: 0,
      } as Entity,
    ]),
  );
  // Half-circle sweep from π wrapping to 2π.
  expect(tess.bounds?.minY).toBeCloseTo(-1, 1);
  expect(tess.bounds?.maxY).toBeCloseTo(0, 1);
});

test("curveSegments option controls circle resolution", () => {
  const doc = makeDoc([
    {
      type: "CIRCLE",
      layer: "0",
      color: null,
      center: { x: 0, y: 0 },
      radius: 5,
    } as Entity,
  ]);
  expect(tessellate(doc, { curveSegments: 8 }).segmentCount).toBe(8);
  expect(tessellate(doc, { curveSegments: 64 }).segmentCount).toBe(64);
});

test("closed polyline with bulge on the wrap-around segment", () => {
  const tess = tessellate(
    makeDoc([
      {
        type: "POLYLINE",
        layer: "0",
        color: null,
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
        ],
        bulges: [0, 1], // wrap segment (2,0)→(0,0) is a semicircle
        closed: true,
      } as Entity,
    ]),
  );
  // Straight segment + sampled semicircle: bounds extend up (CCW from (2,0) to (0,0)).
  expect(tess.segmentCount).toBeGreaterThan(2);
  expect(Math.abs((tess.bounds?.maxY ?? 0) - 1)).toBeLessThan(0.05);
});

test("ELLIPSE entity tessellates around its center", () => {
  const tess = tessellate(
    makeDoc([
      {
        type: "ELLIPSE",
        layer: "0",
        color: null,
        center: { x: 10, y: 0 },
        majorAxis: { x: 4, y: 0 },
        axisRatio: 0.5,
        startParam: 0,
        endParam: 2 * Math.PI,
      } as Entity,
    ]),
  );
  expect(tess.bounds?.minX).toBeCloseTo(6, 1);
  expect(tess.bounds?.maxX).toBeCloseTo(14, 1);
  expect(tess.bounds?.maxY).toBeCloseTo(2, 1);
});

test("unknown layer falls back to white", () => {
  const tess = tessellate(makeDoc([line({ layer: "MISSING" } as Partial<Entity>)]));
  expect([...(tess.layers.get("MISSING")?.colors.slice(0, 3) ?? [])]).toEqual([1, 1, 1]);
});
