import { expect, test } from "vite-plus/test";
import {
  PdfLexer,
  indexOfAscii,
  isDict,
  isKeyword,
  isName,
  isRef,
  isString,
  lastIndexOfAscii,
  latin1,
  toNumber,
} from "../src/parse/pdf/objects.ts";
import type { PdfDict } from "../src/parse/pdf/objects.ts";

const lex = (s: string) => new PdfLexer(new TextEncoder().encode(s));
const parse = (s: string) => lex(s).parseObject();
const text = (v: unknown) => latin1((v as { bytes: Uint8Array }).bytes);

// PDF-2: the lexer serves both the object graph and content streams.
test("parses names, including #-escapes", () => {
  expect(parse("/Type")).toEqual({ name: "Type" });
  expect(parse("/A#20B")).toEqual({ name: "A B" });
  expect(parse("/")).toEqual({ name: "" });
});

test("parses numbers in every form PDF allows", () => {
  expect(parse("42")).toBe(42);
  expect(parse("-17")).toBe(-17);
  expect(parse("+3")).toBe(3);
  expect(parse("3.14")).toBe(3.14);
  expect(parse(".5")).toBe(0.5);
  expect(parse("4.")).toBe(4);
});

test("tells a reference apart from two adjacent numbers", () => {
  expect(parse("12 0 R")).toEqual({ num: 12, gen: 0 });
  // Without the trailing R these are three separate operands, and the lexer
  // must not swallow the second one while looking ahead.
  const l = lex("12 0 5");
  expect(l.parseObject()).toBe(12);
  expect(l.parseObject()).toBe(0);
  expect(l.parseObject()).toBe(5);
});

test("parses literal strings with escapes and nesting", () => {
  expect(text(parse("(hello)"))).toBe("hello");
  expect(text(parse("(a\\(b\\)c)"))).toBe("a(b)c");
  expect(text(parse("(nested (parens) here)"))).toBe("nested (parens) here");
  expect(text(parse("(tab\\there)"))).toBe("tab\there");
  expect(text(parse("(\\101\\102)"))).toBe("AB");
  expect(text(parse("(line\\\ncontinued)"))).toBe("linecontinued");
});

test("parses hex strings, padding an odd final digit", () => {
  expect([...(parse("<48656C6C6F>") as { bytes: Uint8Array }).bytes]).toEqual([
    0x48, 0x65, 0x6c, 0x6c, 0x6f,
  ]);
  expect([...(parse("<4>") as { bytes: Uint8Array }).bytes]).toEqual([0x40]);
  expect([...(parse("<41 42>") as { bytes: Uint8Array }).bytes]).toEqual([0x41, 0x42]);
});

test("parses arrays and dictionaries, including nesting", () => {
  expect(parse("[1 2 3]")).toEqual([1, 2, 3]);
  const d = parse("<< /A 1 /B [2 3] /C << /D /E >> >>") as PdfDict;
  expect(isDict(d)).toBe(true);
  expect(d.get("A")).toBe(1);
  expect(d.get("B")).toEqual([2, 3]);
  expect(isDict(d.get("C"))).toBe(true);
});

test("skips comments and treats booleans and null as values", () => {
  expect(parse("% a comment\n42")).toBe(42);
  expect(parse("true")).toBe(true);
  expect(parse("false")).toBe(false);
  expect(parse("null")).toBeNull();
});

test("returns content-stream operators as keywords", () => {
  const l = lex("10 20 m S");
  expect(l.parseObject()).toBe(10);
  expect(l.parseObject()).toBe(20);
  expect(l.parseObject()).toEqual({ op: "m" });
  expect(l.parseObject()).toEqual({ op: "S" });
});

// Malformed input must fail or degrade, never hang or blow the stack.
test("survives malformed input without hanging", () => {
  expect(() => parse("[".repeat(200))).toThrow(/nesting is too deep/i);
  expect(isDict(parse("<< /A"))).toBe(true); // truncated dict still yields a dict
  expect(parse("[1 2")).toEqual([1, 2]); // unterminated array ends at EOF
  const stray = parse("<< 42 /A 1 >>") as PdfDict;
  expect(stray.get("A")).toBe(1); // a value where a key belongs is skipped
});

test("type guards discriminate the object union", () => {
  expect(isName(parse("/X"))).toBe(true);
  expect(isRef(parse("1 0 R"))).toBe(true);
  expect(isString(parse("(x)"))).toBe(true);
  expect(isKeyword(parse("Tj"))).toBe(true);
  expect(isDict(parse("<<>>"))).toBe(true);
  expect(isName(parse("42"))).toBe(false);
});

test("toNumber coerces only real numbers", () => {
  expect(toNumber(42)).toBe(42);
  expect(toNumber(undefined, 7)).toBe(7);
  expect(toNumber({ name: "x" }, 7)).toBe(7);
  expect(toNumber(Number.NaN, 7)).toBe(7);
});

test("byte search helpers find first and last occurrences", () => {
  const bytes = new TextEncoder().encode("a startxref b startxref c");
  expect(indexOfAscii(bytes, "startxref")).toBe(2);
  expect(lastIndexOfAscii(bytes, "startxref")).toBe(14);
  expect(indexOfAscii(bytes, "nope")).toBe(-1);
  expect(lastIndexOfAscii(bytes, "nope")).toBe(-1);
});
