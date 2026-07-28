import { expect, test } from "vite-plus/test";
import { dxfParser, sniffDxf } from "../src/dxf.ts";
import { DrawingParseError } from "../src/parse/errors.ts";
import { parseWith, toBytes } from "../src/parse/registry.ts";
import type { DrawingParser } from "../src/parse/registry.ts";
import type { DrawingDocument } from "../src/model/types.ts";

const MINIMAL_DXF = `0
SECTION
2
ENTITIES
0
LINE
8
0
10
0
20
0
11
10
21
10
0
ENDSEC
0
EOF
`;

const enc = (s: string) => new TextEncoder().encode(s);

/** A stub parser that claims bytes by prefix — no real format involved. */
function stub(format: string, prefix: string, doc?: Partial<DrawingDocument>): DrawingParser {
  return {
    format,
    sniff: (bytes) => new TextDecoder().decode(bytes.subarray(0, prefix.length)) === prefix,
    parse: () =>
      ({
        layers: new Map(),
        entities: [],
        blocks: new Map(),
        lineTypes: new Map(),
        unsupported: {},
        units: "",
        layouts: [],
        ...doc,
      }) as DrawingDocument,
  };
}

// PARSE-1: every input form normalizes to the same bytes before sniffing.
test("toBytes normalizes every accepted source form", async () => {
  const expected = [0x41, 0x42];
  const bytes = new Uint8Array(expected);
  expect([...(await toBytes("AB"))]).toEqual(expected);
  expect([...(await toBytes(bytes))]).toEqual(expected);
  expect([...(await toBytes(bytes.buffer as ArrayBuffer))]).toEqual(expected);
  expect([...(await toBytes(new Blob([bytes])))]).toEqual(expected);
});

// PARSE-13: sniffs run in the order given; the first match wins.
test("parseWith picks the first parser whose sniff claims the bytes", async () => {
  const first = stub("first", "%X", { units: "first" });
  const second = stub("second", "%X", { units: "second" });
  const doc = await parseWith([first, second], "%X payload");
  expect(doc.units).toBe("first");
  // Reversing the list reverses precedence — the caller owns the order.
  expect((await parseWith([second, first], "%X payload")).units).toBe("second");
});

test("parseWith skips parsers that do not claim the bytes", async () => {
  const doc = await parseWith([stub("a", "AA"), stub("b", "BB", { units: "b" })], "BBxx");
  expect(doc.units).toBe("b");
});

test("parseWith awaits an async parser", async () => {
  const slow: DrawingParser = {
    format: "slow",
    sniff: () => true,
    parse: async () => await Promise.resolve(stub("slow", "").parse(new Uint8Array())),
  };
  await expect(parseWith([slow], "anything")).resolves.toBeDefined();
});

// PARSE-12: no parser claiming the input is a clean, honest failure.
test("unclaimed input reports an unsupported file, with no format", async () => {
  const error = await parseWith([dxfParser], "<!doctype html><title>x</title>").catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toBe("Not a supported drawing file");
  expect((error as DrawingParseError).format).toBeUndefined();
});

// PARSE-12: empty input keeps its own message, ahead of any sniffing.
test("empty and whitespace-only input reads as empty", async () => {
  for (const source of ["", "   \n \n"]) {
    const error = await parseWith([dxfParser], source).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DrawingParseError);
    expect((error as DrawingParseError).message).toBe("The file is empty");
  }
});

// PARSE-13: a claimed-then-rejected file names the parser that rejected it.
test("a claimed but unreadable file carries the format that rejected it", async () => {
  const error = await parseWith([dxfParser], "0\n").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toBe("Not a valid DXF file");
  expect((error as DrawingParseError).format).toBe("dxf");
});

// VIEW-15: an unconfigured viewer names the import that fixes it.
test("an empty parser list names the fix", async () => {
  const error = await parseWith([], MINIMAL_DXF).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DrawingParseError);
  expect((error as DrawingParseError).message).toContain("@aspicio/core/dxf");
  expect((error as DrawingParseError).message).toContain("parsers: [dxfParser]");
});

test("the dxf parser parses a claimed document end to end", async () => {
  const doc = await parseWith([dxfParser], MINIMAL_DXF);
  expect(doc.entities.map((e) => e.type)).toEqual(["LINE"]);
  expect(dxfParser.format).toBe("dxf");
});

// The sniff draws PARSE-12's line: group-code shape is DXF, prose is not.
test("sniffDxf claims group-code text and binary DXF, and nothing else", () => {
  expect(sniffDxf(enc(MINIMAL_DXF))).toBe(true);
  expect(sniffDxf(enc("999\nA comment first\n0\nSECTION\n"))).toBe(true);
  expect(sniffDxf(enc("  0\r\nSECTION\r\n"))).toBe(true); // padded codes, CRLF
  expect(sniffDxf(enc("﻿0\nSECTION\n"))).toBe(true); // BOM
  expect(sniffDxf(enc("AutoCAD Binary DXF\r\n\x1a\x00rest"))).toBe(true);

  expect(sniffDxf(enc("<!doctype html><title>x</title>"))).toBe(false);
  expect(sniffDxf(enc("this is not a valid dxf\n"))).toBe(false);
  expect(sniffDxf(enc("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"))).toBe(false);
  expect(sniffDxf(enc('{\n  "json": true\n}\n'))).toBe(false);
  expect(sniffDxf(new Uint8Array([0x00, 0x01, 0x02, 0x50, 0x4b]))).toBe(false);
  expect(sniffDxf(enc("12345\nsix digits is not a group code\n"))).toBe(false);
});
