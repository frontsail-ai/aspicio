import { deflateSync } from "node:zlib";
import { expect, test } from "vite-plus/test";
import { decodeStream, inflate, isUndecoded, undoPredictor } from "../src/parse/pdf/filters.ts";
import type { PdfDict, PdfValue } from "../src/parse/pdf/objects.ts";

const dict = (entries: [string, PdfValue][]): PdfDict => new Map(entries);
const passthrough = (v: PdfValue | undefined) => v;
const bytes = (...n: number[]) => Uint8Array.from(n);

// PDF-2: Flate is the only content-stream filter strict mode decodes.
test("inflate reads zlib-wrapped streams", async () => {
  const source = new TextEncoder().encode("0 0 100 100 re f");
  const out = await inflate(new Uint8Array(deflateSync(source)));
  expect(new TextDecoder().decode(out)).toBe("0 0 100 100 re f");
});

test("inflate falls back to raw deflate", async () => {
  const source = new TextEncoder().encode("q 1 0 0 1 0 0 cm Q");
  const raw = new Uint8Array(deflateSync(source).subarray(2, -4)); // strip zlib wrapper
  expect(new TextDecoder().decode(await inflate(raw))).toBe("q 1 0 0 1 0 0 cm Q");
});

test("inflate rejects bytes that are not compressed at all", async () => {
  await expect(inflate(bytes(1, 2, 3, 4, 5))).rejects.toThrow(/could not decompress/i);
});

/* ---------- predictors ---------- */

/** Encode rows with a fixed PNG filter type, the inverse of what we test. */
function pngEncode(rows: number[][], type: number, bpp = 1): Uint8Array {
  const width = rows[0]?.length ?? 0;
  const out: number[] = [];
  let prev: number[] = Array.from({ length: width }, () => 0);
  for (const row of rows) {
    out.push(type);
    for (let i = 0; i < width; i++) {
      const a = i >= bpp ? (row[i - bpp] as number) : 0;
      const b = prev[i] as number;
      const c = i >= bpp ? (prev[i - bpp] as number) : 0;
      const raw = row[i] as number;
      let delta: number;
      switch (type) {
        case 1:
          delta = raw - a;
          break;
        case 2:
          delta = raw - b;
          break;
        case 3:
          delta = raw - ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a),
            pb = Math.abs(p - b),
            pc = Math.abs(p - c);
          delta = raw - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          delta = raw;
      }
      out.push(delta & 0xff);
    }
    prev = row;
  }
  return Uint8Array.from(out);
}

const ROWS = [
  [10, 20, 30, 40],
  [12, 25, 33, 41],
  [200, 5, 90, 250],
];
const flat = Uint8Array.from(ROWS.flat());

test.each([
  ["None", 0],
  ["Sub", 1],
  ["Up", 2],
  ["Average", 3],
  ["Paeth", 4],
])("undoes the PNG %s predictor", (_name, type) => {
  const params = dict([
    ["Predictor", 12],
    ["Columns", 4],
    ["Colors", 1],
    ["BitsPerComponent", 8],
  ]);
  const decoded = undoPredictor(pngEncode(ROWS, type), params, passthrough);
  expect([...decoded]).toEqual([...flat]);
});

test("undoes multi-byte-per-pixel Sub, where the left neighbour is a pixel back", () => {
  const rows = [[1, 2, 3, 4, 5, 6]];
  const params = dict([
    ["Predictor", 15],
    ["Columns", 2],
    ["Colors", 3],
    ["BitsPerComponent", 8],
  ]);
  const decoded = undoPredictor(pngEncode(rows, 1, 3), params, passthrough);
  expect([...decoded]).toEqual([1, 2, 3, 4, 5, 6]);
});

test("undoes the TIFF predictor", () => {
  const params = dict([
    ["Predictor", 2],
    ["Columns", 4],
    ["Colors", 1],
    ["BitsPerComponent", 8],
  ]);
  // Deltas along the row: 10, +10, +10, +10 → 10, 20, 30, 40
  const decoded = undoPredictor(bytes(10, 10, 10, 10), params, passthrough);
  expect([...decoded]).toEqual([10, 20, 30, 40]);
});

test("leaves data alone when no predictor applies", () => {
  const raw = bytes(1, 2, 3);
  expect(undoPredictor(raw, undefined, passthrough)).toBe(raw);
  expect(undoPredictor(raw, dict([["Predictor", 1]]), passthrough)).toBe(raw);
});

/* ---------- filter chains ---------- */

test("decodeStream inflates and then unpredicts", async () => {
  const params = dict([
    ["Predictor", 12],
    ["Columns", 4],
    ["Colors", 1],
    ["BitsPerComponent", 8],
  ]);
  const encoded = new Uint8Array(deflateSync(Buffer.from(pngEncode(ROWS, 2))));
  const stream = dict([
    ["Filter", { name: "FlateDecode" }],
    ["DecodeParms", params],
  ]);
  const out = await decodeStream(encoded, stream, passthrough);
  expect(isUndecoded(out)).toBe(false);
  expect([...(out as Uint8Array)]).toEqual([...flat]);
});

test("decodeStream passes unfiltered bytes straight through", async () => {
  const raw = new TextEncoder().encode("q Q");
  const out = await decodeStream(raw, dict([]), passthrough);
  expect(out).toBe(raw);
});

// PDF-8: image codecs are reported, not attempted — they are counted upstream.
test.each(["DCTDecode", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode"])(
  "decodeStream reports %s rather than attempting it",
  async (filter) => {
    const out = await decodeStream(
      bytes(1, 2, 3),
      dict([["Filter", { name: filter }]]),
      passthrough,
    );
    expect(isUndecoded(out)).toBe(true);
    expect((out as { unsupportedFilter: string }).unsupportedFilter).toBe(filter);
  },
);

test("decodeStream reports a filter it has never heard of", async () => {
  const out = await decodeStream(
    bytes(1),
    dict([["Filter", { name: "ASCII85Decode" }]]),
    passthrough,
  );
  expect(isUndecoded(out)).toBe(true);
});

test("decodeStream stops at an image codec that follows Flate", async () => {
  const inner = new Uint8Array(deflateSync(Buffer.from("jpeg bytes")));
  const out = await decodeStream(
    inner,
    dict([["Filter", [{ name: "FlateDecode" }, { name: "DCTDecode" }]]]),
    passthrough,
  );
  expect(isUndecoded(out)).toBe(true);
  expect((out as { unsupportedFilter: string }).unsupportedFilter).toBe("DCTDecode");
});

/**
 * Decoding never throws (review finding).
 *
 * Three separate call sites once turned a stream-level failure into a page- or
 * document-level one, each found only after fixing the last. Reporting damage
 * through the same type callers already handle for image codecs makes a fourth
 * such site impossible to write by accident.
 */
test("damaged Flate data is reported, never thrown", async () => {
  const garbage = bytes(0xff, 0xff, 0xff, 0xff, 0x00, 0x01, 0x02, 0x03);
  const out = await decodeStream(garbage, dict([["Filter", { name: "FlateDecode" }]]), passthrough);
  expect(isUndecoded(out)).toBe(true);
  const undecoded = out as { unsupportedFilter: string; damaged?: boolean };
  expect(undecoded.unsupportedFilter).toBe("FlateDecode");
  // Distinguishable from an image codec: this is a filter we support, on data
  // that would not decode.
  expect(undecoded.damaged).toBe(true);
});

test("an image codec is reported as unsupported, not as damage", async () => {
  const out = await decodeStream(
    bytes(1, 2, 3),
    dict([["Filter", { name: "DCTDecode" }]]),
    passthrough,
  );
  expect((out as { damaged?: boolean }).damaged).toBeUndefined();
});
