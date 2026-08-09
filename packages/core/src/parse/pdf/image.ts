/**
 * Image XObject → RasterImage (PDF-9).
 *
 * Everything the strict pipeline already decodes feeds this: Flate samples
 * (with predictors) through `readStream`, baseline JPEG through `jpeg.ts`,
 * and colours through the same resolved models the vector operators use
 * (color-space.ts) — one policy for pixels and paths, including evaluated
 * tint transforms, so a K-only photograph or a spot-coloured raster keeps
 * its intended colour. Indexed is layered here rather than in the shared
 * resolver: palettes occur in images, and the vector side counts them
 * instead. JPX, JBIG2, CCITT, and anything else undecodable returns
 * `undefined` and the caller counts the skip (PDF-8).
 *
 * Decoded pixels are capped at MAX_IMAGE_DIMENSION on the long side: a
 * viewer never needs a 300-dpi press raster at full resolution, and the cap
 * bounds both memory and SVG payloads.
 */

import type { RasterImage } from "../../model/types.ts";
import { cmykToRgb, grayToRgb, resolveColorSpace, rgb } from "./color-space.ts";
import type { ColorSpaceModel } from "./color-space.ts";
import { isStream } from "./document.ts";
import type { PdfDocument, PdfStream } from "./document.ts";
import { isUndecoded } from "./filters.ts";
import { decodeJpeg, JpegError } from "./jpeg.ts";
import { isName, isRef } from "./objects.ts";
import type { PdfDict, PdfValue } from "./objects.ts";

/** Long-side pixel cap for decoded images. */
export const MAX_IMAGE_DIMENSION = 2048;

/** Document-scoped decode cache: one entry per image object (per fill colour
 * for stencil masks, whose pixels depend on it). `null` = tried and failed. */
export type ImageCache = Map<string, RasterImage | null>;

/** A per-pixel converter for image samples, backed by a shared model. */
interface Converter {
  /** Samples per pixel. */
  components: number;
  /** Convert one pixel's normalized (0..1) components to RGB bytes. */
  toRgb(samples: number[], out: Uint8ClampedArray, at: number): void;
  /** PDF-8 kind the model wants counted — once per decode, not per pixel. */
  counted?: string;
  /** Samples are palette indices, not colour components (skip Decode). */
  indexed?: boolean;
}

const putPacked = (out: Uint8ClampedArray, at: number, packed: number): void => {
  out[at] = (packed >> 16) & 0xff;
  out[at + 1] = (packed >> 8) & 0xff;
  out[at + 2] = packed & 0xff;
};

/** Wrap a resolved colour-space model as a per-pixel converter. */
const fromModel = (model: ColorSpaceModel): Converter | undefined => {
  if (model.components === undefined) return undefined;
  const converter: Converter = {
    components: model.components,
    toRgb: (s, out, at) => {
      const packed = model.toRgb(s);
      if (packed !== undefined) putPacked(out, at, packed);
    },
  };
  if (model.counted !== undefined) converter.counted = model.counted;
  return converter;
};

/** Device fallbacks by arity, for JPEGs whose dict names no usable space. */
const byComponentCount = (count: number): Converter | undefined => {
  if (count === 1) return { components: 1, toRgb: (s, o, a) => putPacked(o, a, grayToRgb(s[0])) };
  if (count === 3)
    return { components: 3, toRgb: (s, o, a) => putPacked(o, a, rgb(s[0], s[1], s[2])) };
  if (count === 4)
    return {
      components: 4,
      toRgb: (s, o, a) => putPacked(o, a, cmykToRgb(s[0], s[1], s[2], s[3])),
    };
  return undefined;
};

/**
 * Resolve an image's colour space to a per-pixel converter.
 *
 * Everything except Indexed delegates to the shared resolver — the single
 * colour policy of PDF-3 — including evaluated tint transforms. Indexed is
 * handled here: palettes are an image construct, and for vector colour the
 * shared resolver counts them instead (PDF-8).
 */
async function resolveConverter(
  doc: PdfDocument,
  value: PdfValue | undefined,
): Promise<Converter | undefined> {
  const resolved = isRef(value) ? await doc.getObject(value.num) : value;
  if (isStream(resolved)) return undefined;

  if (Array.isArray(resolved) && isName(resolved[0])) {
    const family = resolved[0].name;
    if (family === "Indexed" || family === "I") {
      const baseValue = isRef(resolved[1]) ? await doc.getObject(resolved[1].num) : resolved[1];
      const base = isStream(baseValue)
        ? undefined
        : await resolveColorSpace(doc, baseValue, undefined);
      if (!base || base.components === undefined) return undefined;
      const baseComponents = base.components;
      const lookupValue = isRef(resolved[3]) ? await doc.getObject(resolved[3].num) : resolved[3];
      let lookup: Uint8Array | undefined;
      if (lookupValue instanceof Uint8Array) lookup = lookupValue;
      else if (typeof lookupValue === "string")
        lookup = Uint8Array.from(lookupValue as string, (ch: string) => ch.charCodeAt(0));
      else if (isStream(lookupValue)) {
        const decoded = await doc.readStream(lookupValue);
        if (!isUndecoded(decoded)) lookup = decoded;
      }
      if (!lookup) return undefined;
      const table = lookup;
      const parts: number[] = Array.from({ length: baseComponents }, () => 0);
      const converter: Converter = {
        components: 1,
        indexed: true,
        toRgb: (s, out, at) => {
          const index = s[0]; // Indexed samples arrive as raw indices.
          for (let c = 0; c < baseComponents; c++)
            parts[c] = (table[index * baseComponents + c] ?? 0) / 255;
          const packed = base.toRgb(parts);
          if (packed !== undefined) putPacked(out, at, packed);
        },
      };
      if (base.counted !== undefined) converter.counted = base.counted;
      return converter;
    }
  }

  const model = await resolveColorSpace(doc, resolved, undefined);
  return model ? fromModel(model) : undefined;
}

/** Read a possibly-indirect number off a dict. */
async function num(doc: PdfDocument, dict: PdfDict, key: string): Promise<number | undefined> {
  const value = dict.get(key);
  const resolved = isRef(value) ? await doc.getObject(value.num) : value;
  return typeof resolved === "number" ? resolved : undefined;
}

/**
 * Unpack packed samples (1/2/4/8/16 bpc) into per-pixel component arrays,
 * normalized to 0..1 through the Decode array — except `raw` (Indexed),
 * which keeps integer sample values.
 */
function unpackSamples(
  data: Uint8Array,
  width: number,
  height: number,
  components: number,
  bpc: number,
  decode: number[] | undefined,
  raw: boolean,
): Float32Array | undefined {
  const rowBytes = Math.ceil((width * components * bpc) / 8);
  if (data.length < rowBytes * height) return undefined;
  const max = (1 << Math.min(bpc, 8)) - 1;
  const out = new Float32Array(width * height * components);
  let o = 0;
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    let byteAt = rowStart; // 8/16 bpc read whole bytes…
    let bitAt = 0; // …sub-byte depths read a bit cursor within the row.
    for (let x = 0; x < width * components; x++) {
      let v: number;
      if (bpc === 8) {
        v = data[byteAt++];
      } else if (bpc === 16) {
        v = data[byteAt]; // the high byte carries the visual weight
        byteAt += 2;
      } else {
        const byte = data[rowStart + (bitAt >> 3)];
        const shift = 8 - bpc - (bitAt & 7);
        v = (byte >> shift) & max;
        bitAt += bpc;
      }
      const c = x % components;
      if (raw) {
        out[o++] = v;
      } else if (decode) {
        const dMin = decode[c * 2] ?? 0;
        const dMax = decode[c * 2 + 1] ?? 1;
        out[o++] = dMin + (v / max) * (dMax - dMin);
      } else {
        out[o++] = v / max;
      }
    }
  }
  return out;
}

/** Box-filter an RGBA image down so its long side fits the cap. */
function downsample(image: RasterImage, cap: number): RasterImage {
  const { width, height, rgba } = image;
  const long = Math.max(width, height);
  if (long <= cap) return image;
  const scale = cap / long;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * width + sx) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          a += rgba[i + 3];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, rgba: out };
}

/** JPEG planes → RGBA, honouring YCbCr, YCCK, and Adobe CMYK inversion. */
function jpegToRgba(
  planes: Uint8ClampedArray[],
  width: number,
  height: number,
  adobeTransform: number | null,
  decode: number[] | undefined,
  converter: Converter | undefined,
): Uint8ClampedArray | undefined {
  const out = new Uint8ClampedArray(width * height * 4);
  const count = planes.length;
  const samples: number[] = Array.from({ length: count }, () => 0);
  // 3-component data is YCbCr unless Adobe says transform 0 (direct RGB);
  // 4-component YCCK when transform 2. The corpus is all transform 0.
  const yccToRgb = count === 3 && adobeTransform !== 0;
  const ycckToCmyk = count === 4 && adobeTransform === 2;
  // Adobe-written CMYK stores inverted values (the classic Photoshop trap).
  const invert = count === 4 && adobeTransform !== null;

  // A JPEG's own component count wins over the PDF colour space when they
  // disagree; a converter with a matching arity refines the interpretation
  // (e.g. a 1-component Separation tint through its transform).
  const effective: Converter | undefined =
    converter && converter.components === count ? converter : byComponentCount(count);
  if (!effective) return undefined;

  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < count; c++) samples[c] = planes[c][i];
    if (yccToRgb || ycckToCmyk) {
      const [y, cb, cr] = samples;
      const r = y + 1.402 * (cr - 128);
      const g = y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128);
      const b = y + 1.772 * (cb - 128);
      if (ycckToCmyk) {
        samples[0] = 255 - r;
        samples[1] = 255 - g;
        samples[2] = 255 - b;
      } else {
        samples[0] = r;
        samples[1] = g;
        samples[2] = b;
      }
    }
    if (invert) for (let c = 0; c < 4; c++) samples[c] = 255 - samples[c];
    for (let c = 0; c < count; c++) {
      let v = Math.max(0, Math.min(255, samples[c])) / 255;
      if (decode) {
        const dMin = decode[c * 2] ?? 0;
        const dMax = decode[c * 2 + 1] ?? 1;
        v = dMin + v * (dMax - dMin);
      }
      samples[c] = v;
    }
    effective.toRgb(samples, out, i * 4);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Decode an image XObject's SMask into a full-image alpha plane. */
async function decodeSMask(
  doc: PdfDocument,
  value: PdfValue | undefined,
  width: number,
  height: number,
): Promise<Uint8ClampedArray | undefined> {
  const resolved = isRef(value) ? await doc.getObject(value.num) : value;
  if (!resolved || typeof resolved !== "object" || !("dict" in resolved)) return undefined;
  // `withMask: false`: an SMask carries no mask of its own (and a cyclic
  // file must not recurse).
  const mask = await decodeImage(doc, resolved, 0x000000, false);
  if (!mask) return undefined;
  // The soft mask's luminance is the alpha. Nearest-scale to the image size.
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, Math.floor((y * mask.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, Math.floor((x * mask.width) / width));
      out[y * width + x] = mask.rgba[(sy * mask.width + sx) * 4];
    }
  }
  return out;
}

/**
 * Decode one image XObject to capped RGBA. Returns undefined for anything
 * outside the supported set — the caller counts it (PDF-8), so this module
 * never fails a page.
 */
export async function decodeImage(
  doc: PdfDocument,
  stream: PdfStream,
  fillColor: number,
  withMask = true,
  onCounted?: (kind: string) => void,
): Promise<RasterImage | undefined> {
  const dict = stream.dict;
  const width = await num(doc, dict, "Width");
  const height = await num(doc, dict, "Height");
  if (!width || !height || width < 1 || height < 1) return undefined;
  // A pathological header could claim a multi-gigapixel image; refuse
  // before allocating.
  if (width * height > 268_435_456) return undefined;

  const decodeValue = dict.get("Decode") ?? dict.get("D");
  const decodeResolved = isRef(decodeValue) ? await doc.getObject(decodeValue.num) : decodeValue;
  const decode = Array.isArray(decodeResolved)
    ? decodeResolved.map((v) => (typeof v === "number" ? v : 0))
    : undefined;

  const maskValue = dict.get("ImageMask") ?? dict.get("IM");
  const isStencil = maskValue === true;

  const filterRaw = dict.get("Filter");
  const filterValue = isRef(filterRaw) ? await doc.getObject(filterRaw.num) : filterRaw;
  const filters = Array.isArray(filterValue) ? filterValue : [filterValue];
  const filterNames: string[] = [];
  for (const f of filters) if (!isStream(f) && isName(f)) filterNames.push(f.name);
  const isJpeg =
    filterNames.length === 1 && (filterNames[0] === "DCTDecode" || filterNames[0] === "DCT");

  let rgba: Uint8ClampedArray | undefined;

  if (isStencil) {
    // Stencil mask: 1 bpc, sample 0 paints the current fill colour (the
    // default Decode [0 1]; [1 0] flips), sample 1 is transparent.
    const data = await doc.readStream(stream);
    if (isUndecoded(data)) return undefined;
    const samples = unpackSamples(data, width, height, 1, 1, undefined, true);
    if (!samples) return undefined;
    const paintOnOne = decode?.[0] === 1;
    const r = (fillColor >> 16) & 0xff;
    const g = (fillColor >> 8) & 0xff;
    const b = fillColor & 0xff;
    rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const paint = paintOnOne ? samples[i] === 1 : samples[i] === 0;
      if (paint) {
        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = 255;
      }
    }
  } else if (isJpeg) {
    let jpeg;
    try {
      jpeg = decodeJpeg(stream.raw);
    } catch (error) {
      if (error instanceof JpegError) return undefined;
      throw error;
    }
    const converter = await resolveConverter(doc, dict.get("ColorSpace") ?? dict.get("CS"));
    // A colour simplification changes pixels rather than omitting them, so
    // it counts — once per decode, never per pixel (PDF-8).
    if (converter?.counted !== undefined && converter.components === jpeg.planes.length)
      onCounted?.(converter.counted);
    rgba = jpegToRgba(jpeg.planes, jpeg.width, jpeg.height, jpeg.adobeTransform, decode, converter);
    if (rgba && (jpeg.width !== width || jpeg.height !== height)) {
      // Trust the JPEG's own dimensions when the dict disagrees.
      const image = { width: jpeg.width, height: jpeg.height, rgba };
      return downsample(withMask ? await withAlpha(doc, dict, image) : image, MAX_IMAGE_DIMENSION);
    }
  } else {
    const converter = await resolveConverter(doc, dict.get("ColorSpace") ?? dict.get("CS"));
    if (!converter) return undefined;
    if (converter.counted !== undefined) onCounted?.(converter.counted);
    const bpc = (await num(doc, dict, "BitsPerComponent")) ?? 8;
    if (![1, 2, 4, 8, 16].includes(bpc)) return undefined;
    const data = await doc.readStream(stream);
    if (isUndecoded(data)) return undefined;
    // Indexed samples are raw table indices; everything else normalizes
    // through Decode.
    const isIndexed = converter.indexed === true;
    const samples = unpackSamples(
      data,
      width,
      height,
      converter.components,
      bpc,
      decode,
      isIndexed,
    );
    if (!samples) return undefined;
    rgba = new Uint8ClampedArray(width * height * 4);
    const px: number[] = Array.from({ length: converter.components }, () => 0);
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < converter.components; c++) px[c] = samples[i * converter.components + c];
      converter.toRgb(px, rgba, i * 4);
      rgba[i * 4 + 3] = 255;
    }
  }

  if (!rgba) return undefined;
  const base: RasterImage = { width, height, rgba };
  return downsample(withMask ? await withAlpha(doc, dict, base) : base, MAX_IMAGE_DIMENSION);
}

/** Composite the SMask, when present, into the image's alpha channel. */
async function withAlpha(
  doc: PdfDocument,
  dict: PdfDict,
  image: RasterImage,
): Promise<RasterImage> {
  const alpha = await decodeSMask(doc, dict.get("SMask"), image.width, image.height);
  if (!alpha) return image;
  for (let i = 0; i < alpha.length; i++) image.rgba[i * 4 + 3] = alpha[i];
  return image;
}
