import { expect, test } from "vite-plus/test";
import { decodeView, encodeView } from "./viewurl.ts";
import type { ViewLink } from "./viewurl.ts";

const link = (over: Partial<ViewLink> = {}): ViewLink => ({
  view: { center: { x: 12.5, y: -7.25 }, unitsPerPixel: 0.42, rotation: 0.6 },
  hiddenLayerIndices: [],
  spaceIndex: 0,
  ...over,
});

test("encode → decode round-trips the view within precision", () => {
  const decoded = decodeView(encodeView(link({ hiddenLayerIndices: [1, 3], spaceIndex: 2 })));
  expect(decoded).not.toBeNull();
  expect(decoded!.view.center.x).toBeCloseTo(12.5, 4);
  expect(decoded!.view.center.y).toBeCloseTo(-7.25, 4);
  expect(decoded!.view.unitsPerPixel).toBeCloseTo(0.42, 5);
  expect(decoded!.view.rotation).toBeCloseTo(0.6, 4);
  expect(decoded!.hiddenLayerIndices).toEqual([1, 3]);
  expect(decoded!.spaceIndex).toBe(2);
});

test("omits the h and s parts when nothing is hidden and space is model", () => {
  const hash = encodeView(link());
  expect(hash).not.toContain("h=");
  expect(hash).not.toContain("s=");
  expect(hash.startsWith("#v=")).toBe(true);
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
