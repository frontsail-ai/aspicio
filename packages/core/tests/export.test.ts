import { expect, test } from "vite-plus/test";
import { tessellationToSvg } from "../src/export.ts";
import type { DxfDocument, Entity } from "../src/model/types.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

function makeDoc(entities: Entity[]): DxfDocument {
  return {
    layers: new Map([
      ["A", { name: "A", color: 0xffffff, visible: true, frozen: false, entityCount: 0 }],
      ["B", { name: "B", color: 0xffffff, visible: true, frozen: false, entityCount: 0 }],
    ]),
    entities,
    blocks: new Map(),
    lineTypes: new Map(),
    unsupported: {},
  };
}

const redLine: Entity = {
  type: "LINE",
  layer: "A",
  color: 0xff0000,
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
} as Entity;

const blueSolid: Entity = {
  type: "SOLID",
  layer: "B",
  color: 0x0000ff,
  points: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ],
} as Entity;

test("tessellationToSvg emits a viewBox and per-color paths", () => {
  const svg = tessellationToSvg(tessellate(makeDoc([redLine, blueSolid])));
  expect(svg).toContain("<svg");
  expect(svg).toContain("viewBox=");
  expect(svg).toContain('stroke="#ff0000"'); // the red line
  expect(svg).toContain('fill="#0000ff"'); // the blue solid fill
});

test("hidden layers are excluded from the SVG", () => {
  const tess = tessellate(makeDoc([redLine, blueSolid]));
  const svg = tessellationToSvg(tess, (name) => name !== "B");
  expect(svg).toContain('stroke="#ff0000"'); // A still drawn
  expect(svg).not.toContain('fill="#0000ff"'); // B (the solid) excluded
});

test("an empty tessellation yields a valid empty SVG", () => {
  const svg = tessellationToSvg(tessellate(makeDoc([])));
  expect(svg).toContain("<svg");
});

test("a background option adds a backdrop rect", () => {
  const svg = tessellationToSvg(tessellate(makeDoc([redLine])), () => true, {
    background: "#16181d",
  });
  expect(svg).toContain("<rect");
  expect(svg).toContain('fill="#16181d"');
});
