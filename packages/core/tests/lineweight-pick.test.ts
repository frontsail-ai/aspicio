import { expect, test } from "vite-plus/test";
import { Camera2D } from "../src/camera/camera2d.ts";
import { describeEntity } from "../src/entity-info.ts";
import type { DxfDocument, Entity } from "../src/model/types.ts";
import { parseDxf } from "../src/parse/parse.ts";
import { pickEntity } from "../src/pick/pick.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

function makeDoc(entities: Entity[], layerWeight?: number): DxfDocument {
  return {
    layers: new Map([
      [
        "0",
        {
          name: "0",
          color: 0xffffff,
          visible: true,
          frozen: false,
          entityCount: 0,
          lineWeight: layerWeight,
        },
      ],
    ]),
    entities,
    blocks: new Map(),
    lineTypes: new Map(),
    unsupported: {},
  };
}

const line = (id: string, ax: number, ay: number, bx: number, by: number, lw?: number): Entity =>
  ({
    type: "LINE",
    layer: "0",
    color: null,
    lineWeight: lw,
    start: { x: ax, y: ay },
    end: { x: bx, y: by },
  }) as Entity;

/* ---------- lineweight parsing ---------- */

test("parses entity lineweight (370) and drops negative codes", () => {
  const doc = parseDxf(
    [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "LINE",
      "8",
      "0",
      "370",
      "50",
      "10",
      "0",
      "20",
      "0",
      "11",
      "1",
      "21",
      "0",
      "0",
      "LINE",
      "8",
      "0",
      "370",
      "-1",
      "10",
      "0",
      "20",
      "1",
      "11",
      "1",
      "21",
      "1",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n"),
  );
  expect(doc.entities[0].lineWeight).toBe(50);
  expect(doc.entities[1].lineWeight).toBeUndefined(); // -1 = ByLayer → inherit
});

/* ---------- lineweight tessellation ---------- */

test("tessellation carries a width per segment (entity over layer)", () => {
  const tess = tessellate(makeDoc([line("a", 0, 0, 10, 0, 50)], 13));
  const g = tess.layers.get("0")!;
  expect([...g.widths]).toEqual([50]); // entity weight wins over the layer's 13
});

test("segments inherit the layer lineweight when the entity has none", () => {
  const tess = tessellate(makeDoc([line("a", 0, 0, 10, 0)], 35));
  expect([...tess.layers.get("0")!.widths]).toEqual([35]);
});

/* ---------- entity identity for picking ---------- */

test("segments and fills carry their top-level entity index", () => {
  const solid: Entity = {
    type: "SOLID",
    layer: "0",
    color: null,
    points: [
      { x: 0, y: 20 },
      { x: 4, y: 20 },
      { x: 4, y: 24 },
      { x: 0, y: 24 },
    ],
  } as Entity;
  const tess = tessellate(makeDoc([line("a", 0, 0, 10, 0), line("b", 0, 5, 10, 5), solid]));
  const g = tess.layers.get("0")!;
  expect([...g.segmentIds]).toEqual([0, 1]); // two lines, indices 0 and 1
  expect([...g.fillIds]).toEqual([2, 2]); // SOLID is entity 2, two triangles
});

/* ---------- pickEntity ---------- */

test("pickEntity returns the nearest line's entity index", () => {
  const tess = tessellate(makeDoc([line("a", 0, 0, 10, 0), line("b", 0, 5, 10, 5)]));
  const o = tess.offset;
  expect(pickEntity(tess, { x: 5 - o.x, y: 0 - o.y }, 1)?.entityId).toBe(0);
  expect(pickEntity(tess, { x: 5 - o.x, y: 5 - o.y }, 1)?.entityId).toBe(1);
  expect(pickEntity(tess, { x: 5 - o.x, y: 50 - o.y }, 1)).toBeNull();
});

test("pickEntity selects a filled interior when no edge is near", () => {
  const solid: Entity = {
    type: "SOLID",
    layer: "0",
    color: null,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  } as Entity;
  const tess = tessellate(makeDoc([solid]));
  const o = tess.offset;
  expect(pickEntity(tess, { x: 5 - o.x, y: 5 - o.y }, 0.5)?.entityId).toBe(0);
});

/* ---------- describeEntity ---------- */

test("describeEntity measures lines, circles, and closed polylines", () => {
  expect(describeEntity(line("a", 0, 0, 3, 4)).length).toBeCloseTo(5);

  const circle = describeEntity({
    type: "CIRCLE",
    layer: "0",
    color: null,
    center: { x: 0, y: 0 },
    radius: 2,
  } as Entity);
  expect(circle.radius).toBe(2);
  expect(circle.area).toBeCloseTo(Math.PI * 4);

  const poly = describeEntity({
    type: "POLYLINE",
    layer: "0",
    color: null,
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ],
    bulges: [0, 0, 0, 0],
    closed: true,
  } as Entity);
  expect(poly.area).toBeCloseTo(12);
  expect(poly.length).toBeCloseTo(14); // perimeter of the closed 4×3 rectangle
});

/* ---------- camera round-trip ---------- */

test("worldToScreen inverts screenToWorld under pan/zoom/rotation", () => {
  const cam = new Camera2D();
  cam.setViewport(800, 600);
  cam.center = { x: 12, y: -7 };
  cam.unitsPerPixel = 0.5;
  cam.rotation = 0.7;
  const world = cam.screenToWorld(123, 456);
  const back = cam.worldToScreen(world.x, world.y);
  expect(back.x).toBeCloseTo(123);
  expect(back.y).toBeCloseTo(456);
});
