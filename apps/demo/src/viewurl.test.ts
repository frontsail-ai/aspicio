import { expect, test } from "vite-plus/test";
import { decodeView, encodeView, packLayers } from "./viewurl.ts";
import type { ViewLink } from "./viewurl.ts";

const link = (over: Partial<ViewLink> = {}): ViewLink => ({
  view: { center: { x: 12.5, y: -7.25 }, unitsPerPixel: 0.42, rotation: 0.6 },
  spaceIndex: 0,
  ...over,
});

test("encode → decode round-trips the view and hidden layers within precision", () => {
  const decoded = decodeView(encodeView(link({ hiddenLayerIndices: [1, 3], spaceIndex: 2 })));
  expect(decoded).not.toBeNull();
  expect(decoded!.view.center.x).toBeCloseTo(12.5, 4);
  expect(decoded!.view.center.y).toBeCloseTo(-7.25, 4);
  expect(decoded!.view.unitsPerPixel).toBeCloseTo(0.42, 5);
  expect(decoded!.view.rotation).toBeCloseTo(0.6, 4);
  expect(decoded!.hiddenLayerIndices).toEqual([1, 3]);
  expect(decoded!.visibleLayerIndices).toBeUndefined();
  expect(decoded!.spaceIndex).toBe(2);
});

test("round-trips the visible-set encoding (V=)", () => {
  const hash = encodeView(link({ visibleLayerIndices: [17] }));
  expect(hash).toContain("V=17");
  expect(hash).not.toContain("h=");
  const decoded = decodeView(hash);
  expect(decoded!.visibleLayerIndices).toEqual([17]);
  expect(decoded!.hiddenLayerIndices).toBeUndefined();
});

test("packLayers keeps the smaller set — hidden for sparse, visible for solo", () => {
  expect(packLayers([], 6)).toEqual({}); // nothing hidden → omit
  expect(packLayers([1, 3], 6)).toEqual({ hiddenLayerIndices: [1, 3] }); // 2 hidden < 4 visible
  // Solo one layer of 300: 299 hidden vs 1 visible → store the single visible.
  const hidden = Array.from({ length: 300 }, (_, i) => i).filter((i) => i !== 17);
  expect(packLayers(hidden, 300)).toEqual({ visibleLayerIndices: [17] });
  // Tie (3 of 6 hidden) keeps hidden.
  expect(packLayers([0, 1, 2], 6)).toEqual({ hiddenLayerIndices: [0, 1, 2] });
});

test("the solo URL stays tiny instead of listing every hidden index", () => {
  const hidden = Array.from({ length: 300 }, (_, i) => i).filter((i) => i !== 17);
  const hash = encodeView(link({ ...packLayers(hidden, 300) }));
  expect(hash).toContain("V=17");
  expect(hash.length).toBeLessThan(60);
});

test("omits the layer and s parts when nothing is hidden and space is model", () => {
  const hash = encodeView(link());
  expect(hash).not.toContain("h=");
  expect(hash).not.toContain("V=");
  expect(hash).not.toContain("s=");
  expect(hash.startsWith("#v=")).toBe(true);
});

test("an empty visible set (all hidden) encodes and round-trips as V=", () => {
  const hash = encodeView(link({ visibleLayerIndices: [] }));
  expect(hash).toContain("V=");
  expect(decodeView(hash)!.visibleLayerIndices).toEqual([]);
});

test("encodes an empty view (unloaded) as an empty string", () => {
  expect(
    encodeView(link({ view: { center: { x: 0, y: 0 }, unitsPerPixel: 0, rotation: 0 } })),
  ).toBe("");
});

test("decodeView returns null for missing or malformed input", () => {
  expect(decodeView("")).toBeNull();
  expect(decodeView("#s=2")).toBeNull(); // no v=
  expect(decodeView("#v=1,2,3")).toBeNull(); // too few numbers
  expect(decodeView("#v=1,2,nope,0")).toBeNull(); // non-finite
  expect(decodeView("#v=1,2,0,0")).toBeNull(); // non-positive unitsPerPixel
});

test("decodeView is tolerant of junk in h and s", () => {
  const decoded = decodeView("#v=1,2,0.5,0&h=0,-1,x,3&s=-4");
  expect(decoded).not.toBeNull();
  expect(decoded!.hiddenLayerIndices).toEqual([0, 3]); // negatives/NaN dropped
  expect(decoded!.spaceIndex).toBe(0); // clamped up from -4
});
