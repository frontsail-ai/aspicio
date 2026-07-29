/**
 * Stream decoding (PDF-2).
 *
 * Strict mode decodes exactly one family of filters: Flate, plus the byte
 * predictors that ride with it. That is not a simplification — a probe of the
 * Ghent PDF/X-4 suite found every content stream Flate-encoded, with the only
 * other filters (DCT, JPX, JBIG2, CCITT) confined to images we skip and count
 * (PDF-8). Image codecs are reported as undecodable rather than attempted.
 *
 * Inflate is the platform's own `DecompressionStream`, so this costs no
 * dependency in browsers, Node, or Workers.
 */

import { isDict, isName, toNumber } from "./objects.ts";
import type { PdfDict, PdfValue } from "./objects.ts";

/**
 * A stream this build did not decode — an image codec, or data too damaged to
 * inflate.
 *
 * Decoding never throws. Every caller already branches on this type for image
 * codecs, so making damage take the same path means a caller cannot forget to
 * handle it: a stream-level failure can no longer become a page- or
 * document-level one by omission.
 */
export interface UndecodedStream {
  /** The filter that stopped us, e.g. "DCTDecode". */
  readonly unsupportedFilter: string;
  /** True when the filter is one we support but the data would not decode. */
  readonly damaged?: boolean;
}

export const isUndecoded = (v: Uint8Array | UndecodedStream): v is UndecodedStream =>
  "unsupportedFilter" in v;

/** Filters that mean "this is an image", handled by counting, not decoding. */
const IMAGE_FILTERS = new Set([
  "DCTDecode",
  "DCT",
  "JPXDecode",
  "JBIG2Decode",
  "CCITTFaxDecode",
  "CCF",
]);

/**
 * Inflate zlib- or raw-deflate-encoded bytes.
 *
 * PDF's FlateDecode is zlib-wrapped, but enough producers emit raw deflate
 * that falling back is cheaper than rejecting the file.
 */
export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return (await inflateReporting(bytes)).data;
}

/** Inflate, reporting whether the stream ended early (PDF-8). */
export async function inflateReporting(
  bytes: Uint8Array,
): Promise<{ data: Uint8Array; truncated: boolean }> {
  for (const format of ["deflate", "deflate-raw"] as const) {
    const out = await inflatePartial(bytes, format);
    if (out.data.length > 0) return out;
  }
  throw new FlateError();
}

/**
 * Inflate as far as the data allows, keeping whatever decoded.
 *
 * Real PDFs carry streams with bytes after the compressed data, and streams
 * truncated by a wrong `/Length`. `DecompressionStream` rejects both outright,
 * discarding output it had already produced. Four streams in the Ghent PDF/X-4
 * suite are exactly this — valid zlib with a trailing byte — and refusing them
 * would fail the whole file over a byte nobody reads.
 */
async function inflatePartial(
  bytes: Uint8Array,
  format: "deflate" | "deflate-raw",
): Promise<{ data: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let truncated = false;
  try {
    const stream = new DecompressionStream(format);
    const reader = stream.readable.getReader();
    // Read and write concurrently: a stream that errors part-way still hands
    // back everything it decoded before the error.
    const drain = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
      } catch {
        // Trailing garbage or a stream cut short: keep what decoded, but say
        // so, because the drawing may be missing content (PDF-8).
        truncated = true;
      }
    })();
    const writer = stream.writable.getWriter();
    try {
      await writer.write(bytes as BufferSource);
      await writer.close();
    } catch {
      /* the reader side reports the real problem */
    }
    await drain;
  } catch {
    return { data: new Uint8Array(), truncated: true };
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return { data: out, truncated };
}

/** Thrown when neither zlib nor raw deflate can read a stream. */
export class FlateError extends Error {
  constructor() {
    super("Could not decompress a PDF stream");
    this.name = "FlateError";
  }
}

/**
 * Undo a predictor pass (PDF 32000-1 §7.4.4.4).
 *
 * Predictor 2 is TIFF's horizontal differencing; 10..15 are the PNG filters,
 * which store the filter type in a leading byte per row. Cross-reference
 * streams in the wild almost always use PNG Up (12).
 */
export function undoPredictor(
  data: Uint8Array,
  params: PdfDict | undefined,
  resolve: Resolver,
): Uint8Array {
  if (!params) return data;
  const predictor = toNumber(resolve(params.get("Predictor")), 1);
  if (predictor <= 1) return data;

  const colors = toNumber(resolve(params.get("Colors")), 1);
  const bpc = toNumber(resolve(params.get("BitsPerComponent")), 8);
  const columns = toNumber(resolve(params.get("Columns")), 1);
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLength = Math.ceil((colors * bpc * columns) / 8);
  if (rowLength <= 0) return data;

  if (predictor === 2) return undoTiffPredictor(data, rowLength, bytesPerPixel, bpc);

  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  let previous = new Uint8Array(rowLength);
  for (let r = 0; r < rows; r++) {
    const filter = data[r * (rowLength + 1)] as number;
    const source = data.subarray(r * (rowLength + 1) + 1, (r + 1) * (rowLength + 1));
    const row = out.subarray(r * rowLength, (r + 1) * rowLength);
    row.set(source);
    for (let i = 0; i < rowLength; i++) {
      const left = i >= bytesPerPixel ? (row[i - bytesPerPixel] as number) : 0;
      const up = previous[i] as number;
      const upLeft = i >= bytesPerPixel ? (previous[i - bytesPerPixel] as number) : 0;
      const raw = row[i] as number;
      switch (filter) {
        case 0:
          break; // None
        case 1:
          row[i] = (raw + left) & 0xff;
          break; // Sub
        case 2:
          row[i] = (raw + up) & 0xff;
          break; // Up
        case 3:
          row[i] = (raw + ((left + up) >> 1)) & 0xff;
          break; // Average
        case 4:
          row[i] = (raw + paeth(left, up, upLeft)) & 0xff;
          break; // Paeth
        default:
          break; // unknown filter byte: leave the row as read
      }
    }
    previous = row;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** TIFF predictor 2: each component is a delta from the one a pixel to its left. */
function undoTiffPredictor(
  data: Uint8Array,
  rowLength: number,
  bytesPerPixel: number,
  bpc: number,
): Uint8Array {
  if (bpc !== 8) return data; // sub-byte components are not worth the complexity here
  const rows = Math.floor(data.length / rowLength);
  const out = new Uint8Array(data.subarray(0, rows * rowLength));
  for (let r = 0; r < rows; r++) {
    const base = r * rowLength;
    for (let i = bytesPerPixel; i < rowLength; i++)
      out[base + i] =
        ((out[base + i] as number) + (out[base + i - bytesPerPixel] as number)) & 0xff;
  }
  return out;
}

export type Resolver = (value: PdfValue | undefined) => PdfValue | undefined;

/**
 * Run a stream's `/Filter` chain. Returns the decoded bytes, or a marker
 * naming the image codec that stopped us.
 */
export async function decodeStream(
  raw: Uint8Array,
  dict: PdfDict,
  resolve: Resolver,
  onTruncated?: () => void,
): Promise<Uint8Array | UndecodedStream> {
  const filterValue = resolve(dict.get("Filter"));
  if (filterValue === undefined || filterValue === null) return raw;
  const filters = Array.isArray(filterValue) ? filterValue : [filterValue];

  const parmsValue = resolve(dict.get("DecodeParms")) ?? resolve(dict.get("DP"));
  const parms = Array.isArray(parmsValue) ? parmsValue : [parmsValue];

  let data = raw;
  for (let i = 0; i < filters.length; i++) {
    const filter = resolve(filters[i]);
    if (!isName(filter)) continue;
    if (IMAGE_FILTERS.has(filter.name)) return { unsupportedFilter: filter.name };
    if (filter.name !== "FlateDecode" && filter.name !== "Fl")
      return { unsupportedFilter: filter.name };
    let inflated: { data: Uint8Array; truncated: boolean };
    try {
      inflated = await inflateReporting(data);
    } catch {
      // Damaged beyond recovery: report it the same way an image codec is
      // reported, so no caller has to guard against an exception.
      return { unsupportedFilter: filter.name, damaged: true };
    }
    if (inflated.truncated) onTruncated?.();
    data = inflated.data;
    const parm = resolve(parms[i]);
    if (isDict(parm)) data = undoPredictor(data, parm, resolve);
  }
  return data;
}
