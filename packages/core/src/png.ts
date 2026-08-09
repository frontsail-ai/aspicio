/**
 * Minimal PNG writer for embedding raster images in SVG exports.
 *
 * Zero-dependency on purpose, like the rest of the pipeline: the encoder is
 * a greedy-LZ77 deflate using only fixed Huffman codes — a legal subset of
 * deflate every inflater accepts (RFC 1951 §3.2.6). Flat artwork regions
 * compress well; the point is a valid, reasonably sized PNG, not parity
 * with zopfli. Rows use filter type None.
 *
 * The output is verified in tests by round-tripping through `node:zlib` and
 * by rasterizing through resvg (the consumer that motivated it).
 */

import type { RasterImage } from "./model/types.ts";

/* ---------- deflate (fixed Huffman) ---------- */

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

const MIN_MATCH = 3;
const MAX_MATCH = 258;
const WINDOW = 32768;
/** Hash-chain depth bound: longer chains buy little on image data. */
const MAX_CHAIN = 32;

class BitWriter {
  private out: number[] = [];
  private cur = 0;
  private bit = 0;

  /** Append `n` bits of `value`, LSB first (deflate's default packing). */
  putBits(value: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.cur |= ((value >> i) & 1) << this.bit;
      if (++this.bit === 8) {
        this.out.push(this.cur);
        this.cur = 0;
        this.bit = 0;
      }
    }
  }

  /** Append a Huffman code, which deflate packs MSB of the code first. */
  putCode(code: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) {
      this.cur |= ((code >> i) & 1) << this.bit;
      if (++this.bit === 8) {
        this.out.push(this.cur);
        this.cur = 0;
        this.bit = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.bit > 0) this.out.push(this.cur);
    return Uint8Array.from(this.out);
  }
}

/** Emit one literal/length symbol with the fixed code table. */
function putSymbol(w: BitWriter, sym: number): void {
  if (sym <= 143) w.putCode(0x30 + sym, 8);
  else if (sym <= 255) w.putCode(0x190 + (sym - 144), 9);
  else if (sym <= 279) w.putCode(sym - 256, 7);
  else w.putCode(0xc0 + (sym - 280), 8);
}

/** Largest code whose base is ≤ v, by linear scan (tables are tiny). */
function codeFor(v: number, bases: number[]): number {
  let i = bases.length - 1;
  while (bases[i] > v) i--;
  return i;
}

/** Deflate `data` as a single fixed-Huffman block. */
function deflateFixed(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.putBits(1, 1); // final block
  w.putBits(1, 2); // fixed Huffman codes

  const HASH_SIZE = 1 << 15;
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(data.length);
  const hash = (i: number): number =>
    ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HASH_SIZE - 1);

  let i = 0;
  while (i < data.length) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + MIN_MATCH <= data.length) {
      const h = hash(i);
      let candidate = head[h];
      let chain = 0;
      const limit = Math.min(MAX_MATCH, data.length - i);
      while (candidate >= 0 && i - candidate <= WINDOW && chain < MAX_CHAIN) {
        let len = 0;
        while (len < limit && data[candidate + len] === data[i + len]) len++;
        if (len > bestLen) {
          bestLen = len;
          bestDist = i - candidate;
          if (len === limit) break;
        }
        candidate = prev[candidate];
        chain++;
      }
      prev[i] = head[h];
      head[h] = i;
    }

    if (bestLen >= MIN_MATCH) {
      const lc = codeFor(bestLen, LENGTH_BASE);
      putSymbol(w, 257 + lc);
      w.putBits(bestLen - LENGTH_BASE[lc], LENGTH_EXTRA[lc]);
      const dc = codeFor(bestDist, DIST_BASE);
      w.putCode(dc, 5);
      w.putBits(bestDist - DIST_BASE[dc], DIST_EXTRA[dc]);
      // Insert the skipped positions into the hash chains so later matches
      // can still reference them.
      const end = Math.min(i + bestLen, data.length - MIN_MATCH + 1);
      for (let j = i + 1; j < end; j++) {
        const h = hash(j);
        prev[j] = head[h];
        head[h] = j;
      }
      i += bestLen;
    } else {
      putSymbol(w, data[i]);
      i++;
    }
  }

  putSymbol(w, 256); // end of block
  return w.finish();
}

/* ---------- zlib + PNG containers ---------- */

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) c = CRC_TABLE[(c ^ part[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32(v: number): Uint8Array {
  return Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

function chunk(type: string, body: Uint8Array): Uint8Array[] {
  const tag = Uint8Array.from(type, (ch) => ch.charCodeAt(0));
  return [u32(body.length), tag, body, u32(crc32(tag, body))];
}

/** Encode RGBA pixels (rows top-to-bottom) as an 8-bit RGBA PNG. */
export function encodePng(image: RasterImage): Uint8Array {
  const { width, height, rgba } = image;
  // Scanlines: a filter byte (0 = None) before each row.
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  const compressed = deflateFixed(raw);
  const zlib = new Uint8Array(2 + compressed.length + 4);
  zlib[0] = 0x78; // CM=8, 32K window
  zlib[1] = 0x01; // FCHECK making the header divisible by 31
  zlib.set(compressed, 2);
  zlib.set(u32(adler32(raw)), 2 + compressed.length);

  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // compression 0, filter 0, interlace 0

  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", zlib),
    ...chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Base64 without Buffer/btoa, so the module runs in every environment. */
export function toBase64(bytes: Uint8Array): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < bytes.length ? ALPHABET[c & 63] : "=";
  }
  return out;
}
