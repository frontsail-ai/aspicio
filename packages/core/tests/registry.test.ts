/**
 * Registry override tests live in their own file: vitest isolates modules per
 * test file, so mutating the global handler registry cannot leak elsewhere.
 */
import { expect, test, vi } from "vite-plus/test";
import type { DxfDocument, Entity } from "../src/model/types.ts";
import { registerEntityHandler, tessellate } from "../src/tessellate/tessellate.ts";

function makeDoc(entities: Entity[]): DxfDocument {
  return {
    layers: new Map([
      ["0", { name: "0", color: 0xffffff, visible: true, frozen: false, entityCount: 0 }],
    ]),
    entities,
    blocks: new Map(),
    lineTypes: new Map(),
    unsupported: {},
  };
}

const line: Entity = {
  type: "LINE",
  layer: "0",
  color: null,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
};

test("a registered handler overrides the built-in one", () => {
  const handler = vi.fn((_entity: Entity, ctx) => {
    // Replace lines with a triangle marker.
    ctx.addPolyline(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.5, y: 1 },
      ],
      true,
    );
  });
  registerEntityHandler("LINE", handler);

  const tess = tessellate(makeDoc([line]));
  expect(handler).toHaveBeenCalledTimes(1);
  expect(tess.segmentCount).toBe(3); // closed triangle, not 1 line
});

test("addPolyline ignores degenerate input", () => {
  registerEntityHandler("LINE", (_entity, ctx) => {
    ctx.addPolyline([]);
    ctx.addPolyline([{ x: 1, y: 1 }]);
  });
  const tess = tessellate(makeDoc([line]));
  expect(tess.segmentCount).toBe(0);
  expect(tess.bounds).toBeNull();
});
