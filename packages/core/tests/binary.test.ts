import { expect, test } from "vite-plus/test";
import { binaryDxfToText, isBinaryDxf } from "../src/parse/binary.ts";

const SENTINEL = "AutoCAD Binary DXF\r\n\x1a\x00";
const enc = new TextEncoder();

function bytes(...parts: (number[] | Uint8Array | string)[]): Uint8Array {
  const chunks = parts.map((p) =>
    typeof p === "string" ? enc.encode(p) : p instanceof Uint8Array ? p : Uint8Array.from(p),
  );
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const f64 = (n: number): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n, true);
  return b;
};
const cstr = (s: string): Uint8Array => bytes(s, [0]);

test("isBinaryDxf detects the sentinel and rejects text or short input", () => {
  expect(isBinaryDxf(bytes(SENTINEL, "0\nSECTION\n"))).toBe(true);
  expect(isBinaryDxf(enc.encode("0\nSECTION\n0\nEOF\n"))).toBe(false);
  expect(isBinaryDxf(enc.encode("AutoCAD Binary"))).toBe(false); // too short
});

test("decodes a 2-byte-code stream (R13+) with each value type", () => {
  const buf = bytes(
    SENTINEL,
    u16(0),
    cstr("SECTION"),
    u16(2),
    cstr("ENTITIES"),
    u16(8),
    cstr("WALLS"), // string
    u16(10),
    f64(1.5), // double
    u16(70),
    u16(7), // int16
    u16(290),
    [1], // bool (1 byte)
    u16(0),
    cstr("EOF"),
  );
  expect(binaryDxfToText(buf).split("\n")).toEqual([
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "8",
    "WALLS",
    "10",
    "1.5",
    "70",
    "7",
    "290",
    "1",
    "0",
    "EOF",
  ]);
});

test("decodes a 1-byte-code stream (R12), including the 0xFF escape", () => {
  // 1-byte codes: the byte after the first code (0) is 'S', not 0x00.
  const buf = bytes(
    SENTINEL,
    [0],
    cstr("SECTION"),
    [2],
    cstr("ENTITIES"),
    [0xff],
    u16(370), // escaped extended code → int16
    u16(25),
    [0],
    cstr("EOF"),
  );
  expect(binaryDxfToText(buf).split("\n")).toEqual([
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "370",
    "25",
    "0",
    "EOF",
  ]);
});

test("hex-encodes a 310-range binary chunk and keeps the stream aligned", () => {
  const buf = bytes(
    SENTINEL,
    u16(0),
    cstr("SECTION"),
    u16(310),
    [3, 0xde, 0xad, 0xbe], // 1-byte length (3) + 3 bytes
    u16(0),
    cstr("EOF"),
  );
  expect(binaryDxfToText(buf).split("\n")).toEqual(["0", "SECTION", "310", "DEADBE", "0", "EOF"]);
});

test("a truncated record ends the stream instead of throwing", () => {
  // code 10 (double) with only 4 of 8 bytes present.
  const buf = bytes(SENTINEL, u16(0), cstr("SECTION"), u16(10), [1, 2, 3, 4]);
  expect(() => binaryDxfToText(buf)).not.toThrow();
  expect(binaryDxfToText(buf).split("\n")).toEqual(["0", "SECTION"]);
});

test("decodes i32 and i64 value types", () => {
  const i32 = (n: number): Uint8Array => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, n, true);
    return b;
  };
  const i64 = (n: bigint): Uint8Array => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, n, true);
    return b;
  };
  const buf = bytes(
    SENTINEL,
    u16(0),
    cstr("SECTION"),
    u16(90),
    i32(-70000), // int32 range (90–99)
    u16(160),
    i64(4294967296n), // int64 range (160–169)
    u16(0),
    cstr("EOF"),
  );
  expect(binaryDxfToText(buf).split("\n")).toEqual([
    "0",
    "SECTION",
    "90",
    "-70000",
    "160",
    "4294967296",
    "0",
    "EOF",
  ]);
});

test("an unterminated string ends the stream cleanly", () => {
  // Code 2 (string) whose bytes run to the end of the buffer with no NUL.
  const buf = bytes(SENTINEL, u16(0), cstr("SECTION"), u16(2), "ENTIT");
  expect(() => binaryDxfToText(buf)).not.toThrow();
  expect(binaryDxfToText(buf).split("\n")).toEqual(["0", "SECTION"]);
});
