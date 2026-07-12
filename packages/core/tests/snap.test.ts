import { expect, test } from "vite-plus/test";
import type { DxfDocument, Entity } from "../src/model/types.ts";
import { buildSnapIndex } from "../src/snap/snap.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

function makeDoc(entities: Entity[]): DxfDocument {
  return {
    layers: new Map([
      ["A", { name: "A", color: 0xffffff, visible: true, frozen: false, entityCount: 0 }],
      ["B", { name: "B", color: 0xff0000, visible: true, frozen: false, entityCount: 0 }],
    ]),
    entities,
    blocks: new Map(),
    lineTypes: new Map(),
    unsupported: {},
  };
}

const line = (layer: string, ax: number, ay: number, bx: number, by: number): Entity =>
  ({ type: "LINE", layer, color: null, start: { x: ax, y: ay }, end: { x: bx, y: by } }) as Entity;

test("snaps to a segment endpoint (in world coordinates)", () => {
  const index = buildSnapIndex(tessellate(makeDoc([line("A", 0, 0, 10, 0)])), makeDoc([]));
  const hit = index.query({ x: 0.1, y: 0.1 }, 1);
  expect(hit?.kind).toBe("endpoint");
  expect(hit?.point).toEqual({ x: 0, y: 0 });
});

test("snaps to a segment midpoint when no endpoint is near", () => {
  const doc = makeDoc([line("A", 0, 0, 10, 0)]);
  const hit = buildSnapIndex(tessellate(doc), doc).query({ x: 5.2, y: 0.1 }, 1);
  expect(hit?.kind).toBe("midpoint");
  expect(hit?.point).toEqual({ x: 5, y: 0 });
});

test("endpoint beats a closer midpoint (kind priority)", () => {
  // Line (0,0)-(1,0): endpoints at 0 and 1, midpoint at 0.5. A query at 0.4 is
  // closer to the midpoint (0.1) than the endpoint (0.4) — endpoint still wins.
  const doc = makeDoc([line("A", 0, 0, 1, 0)]);
  const hit = buildSnapIndex(tessellate(doc), doc).query({ x: 0.4, y: 0 }, 1);
  expect(hit?.kind).toBe("endpoint");
  expect(hit?.point).toEqual({ x: 0, y: 0 });
});

test("snaps to a circle center from the model", () => {
  const doc = makeDoc([
    { type: "CIRCLE", layer: "A", color: null, center: { x: 5, y: 5 }, radius: 3 } as Entity,
  ]);
  const hit = buildSnapIndex(tessellate(doc), doc).query({ x: 5.1, y: 4.9 }, 1);
  expect(hit?.kind).toBe("center");
  expect(hit?.point).toEqual({ x: 5, y: 5 });
});

test("returns null when nothing is within tolerance", () => {
  const doc = makeDoc([line("A", 0, 0, 10, 0)]);
  expect(buildSnapIndex(tessellate(doc), doc).query({ x: 50, y: 50 }, 1)).toBeNull();
});

test("respects the layer-pickable predicate", () => {
  const doc = makeDoc([line("A", 0, 0, 10, 0)]);
  const index = buildSnapIndex(tessellate(doc), doc);
  expect(index.query({ x: 0, y: 0 }, 1, (name) => name !== "A")).toBeNull();
  expect(index.query({ x: 0, y: 0 }, 1, (name) => name === "A")?.point).toEqual({ x: 0, y: 0 });
});
