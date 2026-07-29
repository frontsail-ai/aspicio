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

/** A stream this build cannot decode — an image codec, essentially. */
export interface UndecodedStream {
  /** The filter that stopped us, e.g. "DCTDecode". */
  readonly unsupportedFilter: string;
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
  let firstError: unknown;
  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const stream = new Blob([bytes as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      firstError ??= error;
    }
  }
  throw new FlateError(firstError);
}

/** Thrown when neither zlib nor raw deflate can read a stream. */
export class FlateError extends Error {
  constructor(cause?: unknown) {
    super("Could not decompress a PDF stream");
    this.name = "FlateError";
    this.cause = cause;
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
    data = await inflate(data);
    const parm = resolve(parms[i]);
    if (isDict(parm)) data = undoPredictor(data, parm, resolve);
  }
  return data;
}
