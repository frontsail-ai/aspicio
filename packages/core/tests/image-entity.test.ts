/**
 * IMAGE entities through the shared pipeline: tessellation placement,
 * bounds, SVG embedding, and the PNG writer underneath it (PDF-9 carries
 * the images here; this file proves the format-agnostic half).
 */

import { inflateSync } from "node:zlib";
import { expect, test } from "vite-plus/test";
import { tessellationToSvg } from "../src/export.ts";
import type { DrawingDocument, ImageEntity, RasterImage } from "../src/model/types.ts";
import { encodePng, toBase64 } from "../src/png.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

function makeDoc(partial: Partial<DrawingDocument>): DrawingDocument {
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

/** A w×h image filled with one RGBA value. */
function solidImage(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, rgba: data };
}

const place = (transform: ImageEntity["transform"], image: RasterImage): ImageEntity => ({
  type: "IMAGE",
  layer: "0",
  color: null,
  transform,
  image,
});

/* ---------- tessellation ---------- */

test("an image's corners are placed by its transform and tracked in bounds", () => {
  // Unit square scaled ×(20,10), moved to (5, 5).
  const doc = makeDoc({
    entities: [place([20, 0, 0, 10, 5, 5], solidImage(2, 2, [9, 9, 9, 255]))],
  });
  const tess = tessellate(doc);
  expect(tess.imageCount).toBe(1);
  expect(tess.bounds).toEqual({ minX: 5, minY: 5, maxX: 25, maxY: 15 });

  const placed = tess.layers.get("0")?.images[0];
  // Corners are recentered around the bounds center (15, 10), bl→br→tr→tl.
  expect(placed?.corners).toEqual([
    { x: -10, y: -5 },
    { x: 10, y: -5 },
    { x: 10, y: 5 },
    { x: -10, y: 5 },
  ]);
  // The transform is recentered the same way, so both agree.
  expect(placed?.transform).toEqual([20, 0, 0, 10, -10, -5]);
  expect(placed?.entityId).toBe(0);
});

test("images widen bounds shared with vector geometry", () => {
  const doc = makeDoc({
    entities: [
      { type: "LINE", layer: "0", color: null, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      place([100, 0, 0, 100, 0, 0], solidImage(1, 1, [1, 2, 3, 255])),
    ],
  });
  const tess = tessellate(doc);
  expect(tess.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  expect(tess.segmentCount).toBe(1);
  expect(tess.imageCount).toBe(1);
});

test("a rotated placement keeps all four corners", () => {
  // 90° CCW rotation about the origin: unit square lands in x ∈ [-1, 0].
  const doc = makeDoc({ entities: [place([0, 1, -1, 0, 0, 0], solidImage(1, 1, [0, 0, 0, 255]))] });
  const tess = tessellate(doc);
  expect(tess.bounds).toEqual({ minX: -1, minY: 0, maxX: 0, maxY: 1 });
});

/* ---------- PNG writer ---------- */

test("encodePng produces a PNG node:zlib can inflate back to the pixels", () => {
  // Gradient + noise-ish content, wider than one hash window step.
  const width = 41;
  const height = 7;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = x * 6;
      rgba[i + 1] = y * 30;
      rgba[i + 2] = (x * y) % 256;
      rgba[i + 3] = 255;
    }
  }
  const png = encodePng({ width, height, rgba });

  // Signature and IHDR fields.
  expect(Buffer.from(png.slice(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
  const view = new DataView(png.buffer, png.byteOffset);
  expect(view.getUint32(16)).toBe(width);
  expect(view.getUint32(20)).toBe(height);

  // IDAT payload inflates to filter-prefixed scanlines with our bytes.
  const idatLen = view.getUint32(33);
  const type = String.fromCharCode(...png.slice(37, 41));
  expect(type).toBe("IDAT");
  const raw = inflateSync(png.slice(41, 41 + idatLen));
  expect(raw.length).toBe(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    expect(raw[y * (1 + width * 4)]).toBe(0); // filter: None
    const row = raw.subarray(y * (1 + width * 4) + 1, (y + 1) * (1 + width * 4));
    expect([...row]).toEqual([...rgba.subarray(y * width * 4, (y + 1) * width * 4)]);
  }
});

test("a large tiled image round-trips (long match distances)", () => {
  // 300×200 RGBA (240KB raw) of repeating 17px tiles: matches reference
  // distances of a full row (1201 bytes) and more, plus overlapping copies.
  const width = 300;
  const height = 200;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = (x % 17) * 15;
      rgba[i + 1] = (y % 17) * 15;
      rgba[i + 2] = ((x + y) % 2) * 255;
      rgba[i + 3] = 255;
    }
  }
  const png = encodePng({ width, height, rgba });
  const view = new DataView(png.buffer, png.byteOffset);
  const idatLen = view.getUint32(33);
  const raw = inflateSync(png.slice(41, 41 + idatLen));
  expect(raw.length).toBe(height * (1 + width * 4));
  // Spot-check rows at the start, middle, and end.
  for (const y of [0, 99, 199]) {
    const row = raw.subarray(y * (1 + width * 4) + 1, (y + 1) * (1 + width * 4));
    expect(
      Buffer.compare(
        Buffer.from(row),
        Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)),
      ),
    ).toBe(0);
  }
  expect(png.length).toBeLessThan(rgba.length / 4); // real compression happened
});

test("flat regions compress far below raw size", () => {
  const image = solidImage(64, 64, [10, 20, 30, 255]);
  const png = encodePng(image);
  // 64×64 RGBA is 16KB raw; LZ77 on a solid color collapses it.
  expect(png.length).toBeLessThan(1024);
});

test("toBase64 matches Buffer's encoding including padding", () => {
  for (const len of [0, 1, 2, 3, 4, 5, 61]) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  }
});

/* ---------- SVG export ---------- */

test("SVG embeds the image as a data URI placed by the transform", () => {
  const doc = makeDoc({
    entities: [place([20, 0, 0, 10, 5, 5], solidImage(2, 2, [0, 128, 255, 255]))],
  });
  const svg = tessellationToSvg(tessellate(doc));

  expect(svg).toContain("data:image/png;base64,");
  // Placement composes the unit-square transform with the row flip:
  // [a, b, -c, -d, c+tx, d+ty] recentered by (-15, -10) → matrix(20 0 0 -10 -10 5).
  expect(svg).toContain('transform="matrix(20 0 0 -10 -10 5)"');
  expect(svg).toContain('preserveAspectRatio="none"');
  // The data URI decodes back to a valid PNG signature.
  const b64 = svg.match(/base64,([A-Za-z0-9+/=]+)/)?.[1] ?? "";
  const bytes = Buffer.from(b64, "base64");
  expect(bytes.slice(0, 4).toString("hex")).toBe("89504e47");
});

test("images on a hidden layer are not exported", () => {
  const doc = makeDoc({
    entities: [place([1, 0, 0, 1, 0, 0], solidImage(1, 1, [255, 0, 0, 255]))],
  });
  const svg = tessellationToSvg(tessellate(doc), (layer) => layer !== "0");
  expect(svg).not.toContain("<image");
});

test("images render under fills and strokes", () => {
  const doc = makeDoc({
    entities: [
      { type: "LINE", layer: "0", color: null, start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
      {
        type: "SOLID",
        layer: "0",
        color: null,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      },
      place([1, 0, 0, 1, 0, 0], solidImage(1, 1, [255, 255, 255, 255])),
    ],
  });
  const svg = tessellationToSvg(tessellate(doc));
  const image = svg.indexOf("<image");
  const fill = svg.indexOf('<path fill="#');
  const stroke = svg.indexOf('<path fill="none"');
  expect(image).toBeGreaterThan(-1);
  expect(fill).toBeGreaterThan(image);
  expect(stroke).toBeGreaterThan(fill);
});
