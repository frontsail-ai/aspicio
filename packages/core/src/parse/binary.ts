/**
 * Binary DXF support.
 *
 * A DXF file can be encoded as text (the usual group-code/value lines) or as
 * "AutoCAD Binary DXF" — the same records packed as bytes behind a 22-byte
 * sentinel. This module detects the binary form and transcodes it back into the
 * canonical text stream, so the existing text parser handles it unchanged.
 *
 * Two on-disk variants exist and both are supported:
 *   - R13+ (AC1012 and later): group codes are 2-byte little-endian.
 *   - R12 and earlier: group codes are a single byte, with `0xFF` escaping to a
 *     following 2-byte code.
 * The first record is always `0 SECTION`, so the byte after the first `0x00`
 * code distinguishes them: `0x00` (a 2-byte code's high byte) vs. the `S` of
 * "SECTION".
 */

/** The 22-byte marker every binary DXF starts with. */
const SENTINEL = "AutoCAD Binary DXF\r\n\x1a\x00";

const utf8 = new TextDecoder("utf-8");

/** True when `bytes` begin with the binary-DXF sentinel. */
export function isBinaryDxf(bytes: Uint8Array): boolean {
  if (bytes.length < SENTINEL.length) return false;
  for (let i = 0; i < SENTINEL.length; i++) {
    if (bytes[i] !== SENTINEL.charCodeAt(i)) return false;
  }
  return true;
}

type ValueKind = "str" | "f64" | "i16" | "i32" | "i64" | "bool" | "bin";

/**
 * The value width/type a group code carries in binary DXF, from the group-code
 * ranges in the AutoCAD 2012 DXF reference. Wrong widths would desync the byte
 * stream, so this table is validated end-to-end against real files.
 */
function valueKind(code: number): ValueKind {
  if (code <= 9) return "str";
  if (code <= 59) return "f64";
  if (code <= 79) return "i16";
  if (code <= 99) return "i32";
  if (code === 100 || code === 102 || code === 105) return "str";
  if (code >= 110 && code <= 149) return "f64";
  if (code >= 160 && code <= 169) return "i64";
  if (code >= 170 && code <= 179) return "i16";
  if (code >= 210 && code <= 239) return "f64";
  if (code >= 270 && code <= 289) return "i16";
  if (code >= 290 && code <= 299) return "bool";
  if (code >= 300 && code <= 309) return "str";
  if (code >= 310 && code <= 319) return "bin"; // length-prefixed binary chunk
  if (code >= 320 && code <= 369) return "str"; // handles
  if (code >= 370 && code <= 389) return "i16";
  if (code >= 390 && code <= 399) return "str";
  if (code >= 400 && code <= 409) return "i16";
  if (code >= 410 && code <= 419) return "str";
  if (code >= 420 && code <= 429) return "i32";
  if (code >= 430 && code <= 439) return "str";
  if (code >= 440 && code <= 459) return "i32";
  if (code >= 460 && code <= 469) return "f64";
  if (code >= 470 && code <= 481) return "str";
  if (code === 999) return "str";
  if (code >= 1000 && code <= 1009) return "str";
  if (code >= 1010 && code <= 1059) return "f64";
  if (code >= 1060 && code <= 1070) return "i16";
  if (code === 1071) return "i32";
  return "str";
}

const HEX = "0123456789ABCDEF";

/**
 * Transcode a binary DXF (per {@link isBinaryDxf}) into the equivalent
 * group-code/value text that `parseDxf` consumes. Reads defensively: a
 * truncated record ends the stream rather than throwing.
 */
export function binaryDxfToText(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length;
  let p = SENTINEL.length;
  // First code is `0 SECTION`; a non-zero second byte means 1-byte codes.
  const twoByte = bytes[p + 1] === 0x00;
  const lines: string[] = [];

  const readString = (): string | null => {
    const start = p;
    while (p < end && bytes[p] !== 0) p++;
    if (p >= end) return null; // unterminated → truncated
    const text = utf8.decode(bytes.subarray(start, p));
    p++; // consume the null
    return text;
  };

  while (p < end) {
    let code: number;
    if (twoByte) {
      if (p + 2 > end) break;
      code = view.getUint16(p, true);
      p += 2;
    } else {
      code = bytes[p++];
      if (code === 0xff) {
        if (p + 2 > end) break;
        code = view.getUint16(p, true);
        p += 2;
      }
    }

    let value: string | undefined;
    switch (valueKind(code)) {
      case "str": {
        const s = readString();
        if (s === null) break;
        value = s;
        break;
      }
      case "f64": {
        if (p + 8 > end) return lines.join("\n");
        value = String(view.getFloat64(p, true));
        p += 8;
        break;
      }
      case "i16": {
        if (p + 2 > end) return lines.join("\n");
        value = String(view.getInt16(p, true));
        p += 2;
        break;
      }
      case "i32": {
        if (p + 4 > end) return lines.join("\n");
        value = String(view.getInt32(p, true));
        p += 4;
        break;
      }
      case "i64": {
        if (p + 8 > end) return lines.join("\n");
        value = String(view.getBigInt64(p, true));
        p += 8;
        break;
      }
      case "bool": {
        if (p + 1 > end) return lines.join("\n");
        value = String(bytes[p]);
        p += 1;
        break;
      }
      case "bin": {
        // 1-byte length prefix + that many bytes; hex-encode (unused by the
        // renderer, but the exact skip keeps the stream aligned).
        if (p + 1 > end) return lines.join("\n");
        const n = bytes[p++];
        if (p + n > end) return lines.join("\n");
        let hex = "";
        for (let i = 0; i < n; i++) {
          const b = bytes[p + i];
          hex += HEX[b >> 4] + HEX[b & 0xf];
        }
        p += n;
        value = hex;
        break;
      }
    }
    // A truncated string read leaves `value` unset via the inner break.
    if (value === undefined) break;
    lines.push(String(code), value);
    if (code === 0 && value === "EOF") break;
  }

  return lines.join("\n");
}
