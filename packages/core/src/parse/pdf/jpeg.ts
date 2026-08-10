/**
 * Baseline JPEG decoder (PDF-9) — SOF0/SOF1, the only DCT flavour the
 * acceptance corpus contains (every DCTDecode image in the Ghent V5.0 and
 * PDFX-ready X4 suites is baseline sequential; none are progressive).
 *
 * Zero-dependency like the rest of the parser. Output is raw component
 * planes plus the Adobe APP14 transform flag: colour interpretation
 * (YCbCr, inverted Adobe CMYK) belongs to the caller, which knows the
 * PDF-level colour space too.
 *
 * Progressive (SOF2), arithmetic coding, and hierarchical modes throw
 * `JpegError`, which the image decoder turns into a counted skip (PDF-8) —
 * a file never fails on an exotic JPEG.
 */

/** An unsupported or malformed JPEG; the image is counted, never fatal. */
export class JpegError extends Error {}

export interface DecodedJpeg {
  width: number;
  height: number;
  /** One plane per component, full resolution, row-major, 0..255. */
  planes: Uint8ClampedArray[];
  /** Adobe APP14 colour transform: 0/1/2, or null when no marker exists. */
  adobeTransform: number | null;
}

/* ---------- Huffman ---------- */

interface HuffmanTable {
  /** Smallest/largest canonical code per length 1..16 (index 0 unused). */
  minCode: Int32Array;
  maxCode: Int32Array;
  /** Index into `values` of the first code of each length. */
  valPtr: Int32Array;
  values: Uint8Array;
}

function buildHuffman(counts: Uint8Array, values: Uint8Array): HuffmanTable {
  const minCode = new Int32Array(17);
  const maxCode = new Int32Array(17).fill(-1);
  const valPtr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    valPtr[len] = k;
    minCode[len] = code;
    code += counts[len - 1];
    k += counts[len - 1];
    maxCode[len] = counts[len - 1] > 0 ? code - 1 : -1;
    code <<= 1;
  }
  return { minCode, maxCode, valPtr, values };
}

/* ---------- bit reader with byte stuffing ---------- */

class BitReader {
  // Explicit fields rather than constructor parameter properties: the
  // example apps compile core from source under `erasableSyntaxOnly`,
  // which rejects the shorthand (same lesson as the interpreter).
  private readonly data: Uint8Array;
  private pos: number;
  private buffer = 0;
  private bits = 0;

  constructor(data: Uint8Array, start: number) {
    this.data = data;
    this.pos = start;
  }

  /** Position of the next unread byte (used to spot restart markers). */
  get bytePos(): number {
    return this.pos;
  }

  /** Drop buffered bits and skip a two-byte marker (RSTn). */
  skipMarker(): void {
    this.buffer = 0;
    this.bits = 0;
    this.pos += 2;
  }

  readBit(): number {
    if (this.bits === 0) {
      if (this.pos >= this.data.length) throw new JpegError("Truncated entropy stream");
      const byte = this.data[this.pos++];
      if (byte === 0xff) {
        const next = this.data[this.pos];
        if (next === 0x00) this.pos++;
        // Any real marker (RSTn mid-symbol, EOI, anything else) means the
        // entropy data ended before the scan was complete.
        else throw new JpegError("Entropy stream ended at a marker");
      }
      this.buffer = byte;
      this.bits = 8;
    }
    this.bits--;
    return (this.buffer >> this.bits) & 1;
  }

  decodeHuffman(table: HuffmanTable): number {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | this.readBit();
      if (table.maxCode[len] >= 0 && code <= table.maxCode[len] && code >= table.minCode[len]) {
        return table.values[table.valPtr[len] + (code - table.minCode[len])];
      }
    }
    throw new JpegError("Invalid Huffman code");
  }

  /** Read `n` magnitude bits and sign-extend per JPEG's EXTEND procedure. */
  receiveExtend(n: number): number {
    if (n === 0) return 0;
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.readBit();
    return v < 1 << (n - 1) ? v - (1 << n) + 1 : v;
  }
}

/* ---------- IDCT (separable, float) ---------- */

const COS = (() => {
  const table = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < 8; x++) {
      table[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return table;
})();

/** In-place 8×8 inverse DCT of one dequantized block. */
function idct(block: Float64Array): void {
  const tmp = new Float64Array(64);
  // Rows.
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) sum += COS[u * 8 + x] * block[y * 8 + u];
      tmp[y * 8 + x] = sum / 2;
    }
  }
  // Columns.
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) sum += COS[v * 8 + y] * tmp[v * 8 + x];
      block[y * 8 + x] = sum / 2;
    }
  }
}

const ZIGZAG = Uint8Array.of(
  0,
  1,
  8,
  16,
  9,
  2,
  3,
  10,
  17,
  24,
  32,
  25,
  18,
  11,
  4,
  5,
  12,
  19,
  26,
  33,
  40,
  48,
  41,
  34,
  27,
  20,
  13,
  6,
  7,
  14,
  21,
  28,
  35,
  42,
  49,
  56,
  57,
  50,
  43,
  36,
  29,
  22,
  15,
  23,
  30,
  37,
  44,
  51,
  58,
  59,
  52,
  45,
  38,
  31,
  39,
  46,
  53,
  60,
  61,
  54,
  47,
  55,
  62,
  63,
);

/* ---------- decoder ---------- */

interface Component {
  id: number;
  h: number;
  v: number;
  quantId: number;
  dcTable?: HuffmanTable;
  acTable?: HuffmanTable;
  /** Plane at the component's own (possibly subsampled) resolution. */
  plane: Float64Array;
  blocksPerLine: number;
  blocksPerColumn: number;
  pred: number;
}

export function decodeJpeg(data: Uint8Array): DecodedJpeg {
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new JpegError("Not a JPEG (no SOI)");

  const quantTables: (Uint16Array | undefined)[] = [];
  const dcTables: (HuffmanTable | undefined)[] = [];
  const acTables: (HuffmanTable | undefined)[] = [];
  let frame: { width: number; height: number; components: Component[] } | undefined;
  let restartInterval = 0;
  let adobeTransform: number | null = null;

  let pos = 2;
  while (pos < data.length) {
    if (data[pos] !== 0xff) throw new JpegError("Marker expected");
    const marker = data[pos + 1];
    if (marker === 0xd9) break; // EOI
    const length = (data[pos + 2] << 8) | data[pos + 3];
    const body = pos + 4;

    if (marker === 0xdb) {
      // DQT: one or more tables, 8- or 16-bit precision, zigzag order.
      let at = body;
      while (at < pos + 2 + length) {
        const precision = data[at] >> 4;
        const id = data[at] & 15;
        at++;
        const table = new Uint16Array(64);
        for (let i = 0; i < 64; i++) {
          table[ZIGZAG[i]] = precision ? (data[at] << 8) | data[at + 1] : data[at];
          at += precision ? 2 : 1;
        }
        quantTables[id] = table;
      }
    } else if (marker === 0xc4) {
      // DHT: one or more Huffman tables.
      let at = body;
      while (at < pos + 2 + length) {
        const cls = data[at] >> 4;
        const id = data[at] & 15;
        at++;
        const counts = data.subarray(at, at + 16);
        at += 16;
        let total = 0;
        for (const c of counts) total += c;
        const table = buildHuffman(counts, data.subarray(at, at + total));
        at += total;
        (cls === 0 ? dcTables : acTables)[id] = table;
      }
    } else if (marker === 0xc0 || marker === 0xc1) {
      // SOF0/SOF1: baseline (extended sequential decodes identically here).
      const height = (data[body + 1] << 8) | data[body + 2];
      const width = (data[body + 3] << 8) | data[body + 4];
      const count = data[body + 5];
      const components: Component[] = [];
      for (let i = 0; i < count; i++) {
        const at = body + 6 + i * 3;
        components.push({
          id: data[at],
          h: data[at + 1] >> 4,
          v: data[at + 1] & 15,
          quantId: data[at + 2],
          plane: new Float64Array(0),
          blocksPerLine: 0,
          blocksPerColumn: 0,
          pred: 0,
        });
      }
      frame = { width, height, components };
    } else if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8) {
      throw new JpegError(`Unsupported JPEG mode (SOF${marker - 0xc0})`);
    } else if (marker === 0xdd) {
      restartInterval = (data[body] << 8) | data[body + 1];
    } else if (marker === 0xee) {
      // APP14 "Adobe": the transform byte is the last of the 12-byte body.
      const isAdobe =
        data[body] === 0x41 &&
        data[body + 1] === 0x64 &&
        data[body + 2] === 0x6f &&
        data[body + 3] === 0x62 &&
        data[body + 4] === 0x65;
      if (isAdobe) adobeTransform = data[body + 11];
    } else if (marker === 0xda) {
      // SOS: entropy-coded data follows.
      if (!frame) throw new JpegError("SOS before SOF");
      const count = data[body];
      const scan: Component[] = [];
      for (let i = 0; i < count; i++) {
        const id = data[body + 1 + i * 2];
        const tables = data[body + 2 + i * 2];
        const component = frame.components.find((c) => c.id === id);
        if (!component) throw new JpegError("Scan names a missing component");
        component.dcTable = dcTables[tables >> 4];
        component.acTable = acTables[tables & 15];
        scan.push(component);
      }
      if (scan.length !== frame.components.length)
        throw new JpegError("Multi-scan baseline is not supported");
      pos = decodeScan(data, pos + 2 + length, frame, scan, quantTables, restartInterval);
      continue;
    }
    // APPn, COM, and anything unhandled: skip by length.
    pos += 2 + length;
  }

  if (!frame) throw new JpegError("No frame header");

  // Upsample every component to full resolution by pixel replication.
  const { width, height, components } = frame;
  const maxH = Math.max(...components.map((c) => c.h));
  const maxV = Math.max(...components.map((c) => c.v));
  const planes = components.map((component) => {
    const out = new Uint8ClampedArray(width * height);
    const sx = component.h / maxH;
    const sy = component.v / maxV;
    const lineWidth = component.blocksPerLine * 8;
    for (let y = 0; y < height; y++) {
      const srcRow = Math.min(Math.floor(y * sy), component.blocksPerColumn * 8 - 1) * lineWidth;
      for (let x = 0; x < width; x++) {
        const sxi = Math.min(Math.floor(x * sx), lineWidth - 1);
        out[y * width + x] = component.plane[srcRow + sxi] + 128;
      }
    }
    return out;
  });

  return { width, height, planes, adobeTransform };
}

/** Decode one entropy-coded scan; returns the position after its data. */
function decodeScan(
  data: Uint8Array,
  start: number,
  frame: { width: number; height: number; components: Component[] },
  scan: Component[],
  quantTables: (Uint16Array | undefined)[],
  restartInterval: number,
): number {
  const maxH = Math.max(...scan.map((c) => c.h));
  const maxV = Math.max(...scan.map((c) => c.v));
  const mcusPerLine = Math.ceil(frame.width / (8 * maxH));
  const mcusPerColumn = Math.ceil(frame.height / (8 * maxV));

  for (const component of scan) {
    component.blocksPerLine = mcusPerLine * component.h;
    component.blocksPerColumn = mcusPerColumn * component.v;
    component.plane = new Float64Array(component.blocksPerLine * 8 * component.blocksPerColumn * 8);
    component.pred = 0;
  }

  let reader = new BitReader(data, start);
  const block = new Float64Array(64);

  const decodeBlock = (component: Component, blockRow: number, blockCol: number): void => {
    const quant = quantTables[component.quantId];
    if (!quant || !component.dcTable || !component.acTable)
      throw new JpegError("Missing quantization or Huffman table");

    block.fill(0);
    const t = reader.decodeHuffman(component.dcTable);
    component.pred += reader.receiveExtend(t);
    block[0] = component.pred * quant[0];
    let k = 1;
    while (k < 64) {
      const rs = reader.decodeHuffman(component.acTable);
      const r = rs >> 4;
      const s = rs & 15;
      if (s === 0) {
        if (r !== 15) break; // EOB
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) throw new JpegError("AC coefficient out of range");
      block[ZIGZAG[k]] = reader.receiveExtend(s) * quant[ZIGZAG[k]];
      k++;
    }
    idct(block);

    const lineWidth = component.blocksPerLine * 8;
    const baseRow = blockRow * 8;
    const baseCol = blockCol * 8;
    for (let y = 0; y < 8; y++) {
      component.plane.set(block.subarray(y * 8, y * 8 + 8), (baseRow + y) * lineWidth + baseCol);
    }
  };

  const mcuCount = mcusPerLine * mcusPerColumn;
  let mcu = 0;
  while (mcu < mcuCount) {
    const until = restartInterval > 0 ? Math.min(mcu + restartInterval, mcuCount) : mcuCount;
    for (; mcu < until; mcu++) {
      const mcuRow = Math.floor(mcu / mcusPerLine);
      const mcuCol = mcu % mcusPerLine;
      for (const component of scan) {
        for (let v = 0; v < component.v; v++) {
          for (let h = 0; h < component.h; h++) {
            decodeBlock(component, mcuRow * component.v + v, mcuCol * component.h + h);
          }
        }
      }
    }
    if (mcu < mcuCount) {
      // Expect an RSTn marker between restart intervals. Skip past any
      // padding, stepping over stuffed 0xFF00 pairs (entropy bytes, not
      // markers).
      let at = reader.bytePos;
      while (at + 1 < data.length && !(data[at] === 0xff && data[at + 1] !== 0x00)) at++;
      if (at + 1 >= data.length || data[at + 1] < 0xd0 || data[at + 1] > 0xd7)
        throw new JpegError("Missing restart marker");
      reader = new BitReader(data, at + 2);
      for (const component of scan) component.pred = 0;
    }
  }

  // Find the next marker after the scan for the caller to continue at.
  let at = reader.bytePos;
  while (at + 1 < data.length && !(data[at] === 0xff && data[at + 1] !== 0x00)) at++;
  return at + 1 < data.length ? at : data.length;
}
