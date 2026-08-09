/**
 * Raster images through the PDF parser (PDF-9): every decode path has a
 * fixture that isolates it, and the pixel assertions are corner-exact where
 * the source is lossless — a flipped row order, transposed axis, or missed
 * inversion moves a specific pixel to a specific wrong place.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import type { ImageEntity } from "../src/model/types.ts";
import { parsePdfBytes } from "../src/parse/pdf/parse.ts";

const parse = async (name: string) =>
  parsePdfBytes(
    new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/pdf/${name}`, import.meta.url)))),
  );

/** The single IMAGE entity a one-image fixture parses to. */
const onlyImage = async (name: string): Promise<ImageEntity> => {
  const doc = await parse(name);
  const images = doc.entities.filter((e): e is ImageEntity => e.type === "IMAGE");
  expect(images, `${name} should hold exactly one image`).toHaveLength(1);
  return images[0];
};

/** RGBA of pixel (x, y), rows top-to-bottom. */
const px = (e: ImageEntity, x: number, y: number): number[] => [
  ...e.image.rgba.subarray((y * e.image.width + x) * 4, (y * e.image.width + x) * 4 + 4),
];

test("an RGB image decodes with rows in top-to-bottom order", async () => {
  const e = await onlyImage("image-flate-rgb.pdf");
  expect(e.image.width).toBe(2);
  expect(e.image.height).toBe(2);
  // Row 0 is the image's top edge: red, green. Row 1: blue, white.
  expect(px(e, 0, 0)).toEqual([255, 0, 0, 255]);
  expect(px(e, 1, 0)).toEqual([0, 255, 0, 255]);
  expect(px(e, 0, 1)).toEqual([0, 0, 255, 255]);
  expect(px(e, 1, 1)).toEqual([255, 255, 255, 255]);
  // The `cm` places the unit square: 40×40 at (10, 10).
  expect(e.transform).toEqual([40, 0, 0, 40, 10, 10]);
  expect(e.layer).toBe("Content");
});

test("a gray ramp decodes through DeviceGray", async () => {
  const e = await onlyImage("image-flate-gray.pdf");
  expect([px(e, 0, 0)[0], px(e, 1, 0)[0], px(e, 2, 0)[0], px(e, 3, 0)[0]]).toEqual([
    0, 85, 170, 255,
  ]);
});

test("CMYK converts naively and the SMask lands in alpha", async () => {
  const e = await onlyImage("image-flate-cmyk-smask.pdf");
  // Pure C, M, Y, K quadrants under the vector-side conversion (PDF-9).
  expect(px(e, 0, 0)).toEqual([0, 255, 255, 255]); // cyan, mask 255
  expect(px(e, 1, 0)).toEqual([255, 0, 255, 0]); // magenta, mask 0
  expect(px(e, 0, 1)).toEqual([255, 255, 0, 255]); // yellow
  expect(px(e, 1, 1)).toEqual([0, 0, 0, 0]); // black, mask 0
});

test("an Indexed palette resolves through its base space", async () => {
  const e = await onlyImage("image-flate-indexed.pdf");
  expect(px(e, 0, 0).slice(0, 3)).toEqual([255, 0, 0]);
  expect(px(e, 1, 0).slice(0, 3)).toEqual([0, 255, 0]);
  expect(px(e, 0, 1).slice(0, 3)).toEqual([0, 0, 255]);
  expect(px(e, 1, 1).slice(0, 3)).toEqual([255, 0, 0]);
});

test("1-bit samples unpack with byte-aligned rows", async () => {
  const e = await onlyImage("image-1bpc.pdf");
  // 0xAA then 0x55: alternating checker, rows offset by one.
  for (let x = 0; x < 8; x++) {
    expect(px(e, x, 0)[0], `row 0 x=${x}`).toBe(x % 2 === 0 ? 255 : 0);
    expect(px(e, x, 1)[0], `row 1 x=${x}`).toBe(x % 2 === 0 ? 0 : 255);
  }
});

test("16-bit samples keep their high byte", async () => {
  const e = await onlyImage("image-16bpc.pdf");
  expect(px(e, 0, 0)[0]).toBe(0x00);
  expect(px(e, 1, 0)[0]).toBe(0xff);
});

test("a Decode array remaps samples ([1 0] inverts)", async () => {
  const e = await onlyImage("image-decode-invert.pdf");
  expect(px(e, 0, 0)[0]).toBe(255);
  expect(px(e, 1, 0)[0]).toBe(0);
});

test("a stencil mask paints the current fill colour where samples are 0", async () => {
  const e = await onlyImage("image-stencil-mask.pdf");
  expect(px(e, 0, 0)).toEqual([255, 0, 0, 255]); // painted red
  expect(px(e, 1, 0)[3]).toBe(0); // clear
  expect(px(e, 0, 1)).toEqual([255, 0, 0, 255]);
  expect(px(e, 1, 1)).toEqual([255, 0, 0, 255]);
});

test("a Separation image colours through its evaluated tint transform (PDF-3, PDF-9)", async () => {
  // The fixture's Type 2 transform maps tint → CMYK (0,0,0,t): the same
  // resolver the vector operators use, so tint 0 is paper and tint 1 ink.
  const e = await onlyImage("image-separation-tint.pdf");
  expect(px(e, 0, 0)[0]).toBe(255); // tint 0 → no ink → white
  expect(px(e, 1, 0)[0]).toBe(0); // tint 1 → full ink → black
});

test("an image XObject's /OC puts its pixels on that layer (PDF-7, PDF-9)", async () => {
  const doc = await parse("image-oc-layer.pdf");
  const images = doc.entities.filter((e): e is ImageEntity => e.type === "IMAGE");
  expect(images[0]?.layer).toBe("Artwork");
  expect(doc.layers.get("Artwork")?.entityCount).toBe(1);
});

test("a baseline JPEG decodes with every quadrant in place", async () => {
  const e = await onlyImage("image-jpeg.pdf");
  expect(e.image.width).toBe(16);
  const near = (actual: number[], wanted: number[]): void => {
    for (let i = 0; i < 3; i++) expect(Math.abs(actual[i] - wanted[i])).toBeLessThanOrEqual(12);
  };
  near(px(e, 4, 4), [255, 0, 0]);
  near(px(e, 12, 4), [0, 255, 0]);
  near(px(e, 4, 12), [0, 0, 255]);
  near(px(e, 12, 12), [255, 255, 0]);
});

test("an Adobe CMYK JPEG un-inverts (the Photoshop convention)", async () => {
  const e = await onlyImage("image-jpeg-cmyk-adobe.pdf");
  // The ICC round-trip shifts hues, so assert dominant channels only —
  // without the inversion every quadrant would read as its complement.
  const dominant = (p: number[], on: number[], off: number[]): void => {
    for (const ch of on) expect(p[ch]).toBeGreaterThan(180);
    for (const ch of off) expect(p[ch]).toBeLessThan(160);
  };
  dominant(px(e, 4, 4), [0], [2]); // red-ish
  dominant(px(e, 12, 4), [1], []); // green-ish
  dominant(px(e, 4, 12), [2], [0]); // blue-ish
  dominant(px(e, 12, 12), [0, 1], [2]); // yellow-ish
});

test("the dieline always reads over its artwork (PDF-9)", async () => {
  const doc = await parse("artwork-dieline.pdf");
  const kinds = doc.entities.map((e) => e.type);
  expect(kinds.filter((k) => k === "IMAGE")).toHaveLength(1);
  expect(kinds.filter((k) => k === "POLYLINE")).toHaveLength(2);

  const image = doc.entities.find((e): e is ImageEntity => e.type === "IMAGE");
  // The SMask fades the right column: alpha 255 on the left, 80 there.
  expect(px(image as ImageEntity, 0, 0)[3]).toBe(255);
  expect(px(image as ImageEntity, 3, 0)[3]).toBe(80);
  expect(doc.unsupported["Image"]).toBeUndefined();
});

test("one shared XObject decodes once and places twice (PDF-9)", async () => {
  // The corpus proves this at scale (issue14824: one image, 27 pages);
  // the committed proof is identity — both placements hold the same
  // RasterImage object, so the decode ran once.
  const doc = await parse("image-shared-twice.pdf");
  const images = doc.entities.filter((e): e is ImageEntity => e.type === "IMAGE");
  expect(images).toHaveLength(2);
  expect(images[0].image).toBe(images[1].image);
  expect(images[0].transform).not.toEqual(images[1].transform);
});
