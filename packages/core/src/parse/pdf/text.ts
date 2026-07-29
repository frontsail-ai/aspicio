/**
 * Character decoding for PDF text (PDF-4).
 *
 * A PDF string is bytes; what those bytes *mean* depends on the font. Three
 * sources answer that, in descending order of authority:
 *
 *   1. `/ToUnicode` — an explicit map the producer wrote for extraction. When
 *      present it is definitive, and the Ghent corpus ships 101 of them.
 *   2. `/Differences` — per-code glyph names, which resolve through the
 *      standard glyph list.
 *   3. The font's base encoding — WinAnsi or Standard.
 *
 * Getting readable text out is the whole goal: glyph *shapes* are explicitly
 * out of scope, since every font renders through the built-in stroke font.
 */

import { PdfLexer, isKeyword, isName, isString, latin1 } from "./objects.ts";
import type { PdfDict, PdfValue } from "./objects.ts";
import type { PdfDocument } from "./document.ts";
import { isStream } from "./document.ts";

/** How a font turns string bytes into text. */
export interface FontDecoder {
  /** Decode one PDF string's bytes into text. */
  decode(bytes: Uint8Array): string;
  /** True when codes are two bytes wide (composite fonts). */
  readonly twoByte: boolean;
  /**
   * True when the font's glyphs are drawing procedures rather than an embedded
   * program. Their artwork is counted as skipped, never drawn (PDF-8).
   */
  readonly type3: boolean;
}

/* ---------- encodings ---------- */

/**
 * WinAnsiEncoding's upper half (0x80–0xFF).
 *
 * The lower half is ASCII in every encoding PDF uses, so only the part that
 * actually differs is tabulated.
 */
const WIN_ANSI_HIGH =
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ" +
  "‘’“”•–—˜™š›œžŸ" +
  " ¡¢£¤¥¦§¨©ª«¬­®¯" +
  "°±²³´µ¶·¸¹º»¼½¾¿" +
  "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏ" +
  "ÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß" +
  "àáâãäåæçèéêëìíîï" +
  "ðñòóôõö÷øùúûüýþÿ";

/** StandardEncoding's punctuation differences from ASCII, by code. */
const STANDARD_OVERRIDES: Readonly<Record<number, string>> = {
  0x27: "’", // quoteright
  0x60: "‘", // quoteleft
  0xa1: "¡",
  0xa2: "¢",
  0xa3: "£",
  0xa4: "⁄",
  0xa5: "¥",
  0xa7: "§",
  0xa8: "¤",
  0xa9: "'",
  0xaa: "“",
  0xab: "«",
  0xb1: "–",
  0xb7: "•",
  0xbb: "»",
  0xbf: "¡",
  0xd0: "—",
  0xe1: "Æ",
  0xe9: "Ø",
  0xf1: "æ",
  0xf9: "ø",
};

/** The glyph names worth resolving from a `/Differences` array. */
const GLYPH_NAMES: Readonly<Record<string, string>> = {
  space: " ",
  exclam: "!",
  quotedbl: '"',
  numbersign: "#",
  dollar: "$",
  percent: "%",
  ampersand: "&",
  quotesingle: "'",
  parenleft: "(",
  parenright: ")",
  asterisk: "*",
  plus: "+",
  comma: ",",
  hyphen: "-",
  period: ".",
  slash: "/",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  colon: ":",
  semicolon: ";",
  less: "<",
  equal: "=",
  greater: ">",
  question: "?",
  at: "@",
  bracketleft: "[",
  backslash: "\\",
  bracketright: "]",
  asciicircum: "^",
  underscore: "_",
  grave: "`",
  braceleft: "{",
  bar: "|",
  braceright: "}",
  asciitilde: "~",
  quoteleft: "‘",
  quoteright: "’",
  quotedblleft: "“",
  quotedblright: "”",
  endash: "–",
  emdash: "—",
  bullet: "•",
  ellipsis: "…",
  degree: "°",
  copyright: "©",
  registered: "®",
  trademark: "™",
  euro: "€",
  sterling: "£",
  yen: "¥",
  cent: "¢",
  section: "§",
  paragraph: "¶",
  dagger: "†",
  fi: "ﬁ",
  fl: "ﬂ",
  germandbls: "ß",
  ae: "æ",
  AE: "Æ",
  oslash: "ø",
  Oslash: "Ø",
};

/** Resolve a glyph name, including the `uniXXXX` and `gNN` conventions. */
export function glyphNameToText(name: string): string {
  const known = GLYPH_NAMES[name];
  if (known !== undefined) return known;
  if (/^[A-Za-z]$/.test(name)) return name;
  const uni = /^uni([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1] as string, 16));
  const u = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (u) return String.fromCodePoint(parseInt(u[1] as string, 16));
  // A subset-glyph name like `g34` carries no character meaning at all.
  return "";
}

/** Single-byte code → text, for a simple font. */
function baseEncodingTable(encodingName: string | undefined): string[] {
  const table: string[] = [];
  for (let code = 0; code < 256; code++) {
    if (code >= 0x20 && code < 0x7f) table[code] = String.fromCharCode(code);
    else table[code] = "";
  }
  if (encodingName === "WinAnsiEncoding" || encodingName === undefined) {
    for (let i = 0; i < WIN_ANSI_HIGH.length; i++) {
      const ch = WIN_ANSI_HIGH[i] as string;
      table[0x80 + i] = ch.charCodeAt(0) < 0x20 ? "" : ch;
    }
  } else if (encodingName === "MacRomanEncoding" || encodingName === "StandardEncoding") {
    for (const [code, ch] of Object.entries(STANDARD_OVERRIDES)) table[Number(code)] = ch;
  }
  return table;
}

/* ---------- /ToUnicode CMaps ---------- */

/**
 * Parse a `/ToUnicode` CMap into a code → text map.
 *
 * Only `bfchar` and `bfrange` matter for extraction; the codespace ranges that
 * surround them describe code *widths*, which the font's subtype already tells
 * us more reliably.
 */
export function parseToUnicode(data: Uint8Array): Map<number, string> {
  const map = new Map<number, string>();
  const lexer = new PdfLexer(data);
  let operands: PdfValue[] = [];

  const codeOf = (v: PdfValue | undefined): number | undefined => {
    if (!isString(v)) return undefined;
    let n = 0;
    for (const b of v.bytes) n = n * 256 + b;
    return n;
  };
  const textOf = (v: PdfValue | undefined): string => {
    if (!isString(v)) return "";
    // UTF-16BE, which is what a bf destination always is.
    let out = "";
    for (let i = 0; i + 1 < v.bytes.length; i += 2)
      out += String.fromCharCode(((v.bytes[i] as number) << 8) | (v.bytes[i + 1] as number));
    if (v.bytes.length === 1) out = String.fromCharCode(v.bytes[0] as number);
    return out;
  };

  while (!lexer.atEnd) {
    lexer.skipSpace();
    if (lexer.atEnd) break;
    const before = lexer.pos;
    const value = lexer.parseObject();
    if (lexer.pos === before) {
      lexer.pos++;
      continue;
    }
    if (!isKeyword(value)) {
      operands.push(value);
      if (operands.length > 512) operands = operands.slice(-8);
      continue;
    }

    if (value.op === "beginbfchar") {
      // pairs of <src> <dst> until endbfchar
      const items = readUntil(lexer, "endbfchar");
      for (let i = 0; i + 1 < items.length; i += 2) {
        const code = codeOf(items[i]);
        if (code !== undefined) map.set(code, textOf(items[i + 1]));
      }
    } else if (value.op === "beginbfrange") {
      const items = readUntil(lexer, "endbfrange");
      for (let i = 0; i + 2 < items.length; i += 3) {
        const low = codeOf(items[i]);
        const high = codeOf(items[i + 1]);
        const dst = items[i + 2];
        if (low === undefined || high === undefined) continue;
        // Guard against a corrupt range claiming millions of codes.
        const count = Math.min(high - low, 0xffff);
        if (Array.isArray(dst)) {
          for (let k = 0; k <= count && k < dst.length; k++) map.set(low + k, textOf(dst[k]));
        } else if (isString(dst)) {
          const base = textOf(dst);
          const lastUnit = base.charCodeAt(base.length - 1);
          for (let k = 0; k <= count; k++)
            // A range's destination increments its final code unit.
            map.set(low + k, base.slice(0, -1) + String.fromCharCode(lastUnit + k));
        }
      }
    }
    operands = [];
  }
  return map;
}

/** Collect operands until the named keyword, so a section reads as a unit. */
function readUntil(lexer: PdfLexer, end: string): PdfValue[] {
  const items: PdfValue[] = [];
  while (!lexer.atEnd) {
    lexer.skipSpace();
    if (lexer.atEnd) break;
    const before = lexer.pos;
    const value = lexer.parseObject();
    if (lexer.pos === before) {
      lexer.pos++;
      continue;
    }
    if (isKeyword(value)) {
      if (value.op === end) break;
      continue;
    }
    items.push(value);
    if (items.length > 100_000) break; // malformed CMap
  }
  return items;
}

/* ---------- building a decoder for one font ---------- */

/**
 * Build a decoder for a font dictionary.
 *
 * Falls back through the three sources in order, so a font with no usable
 * information still yields Latin-1-ish text rather than nothing.
 */
export async function buildFontDecoder(doc: PdfDocument, font: PdfDict): Promise<FontDecoder> {
  const subtype = font.get("Subtype");
  const subtypeName = isName(subtype) ? subtype.name : "";
  // Composite fonts address glyphs with two-byte codes; simple fonts use one.
  const twoByte = subtypeName === "Type0";

  let toUnicode: Map<number, string> | undefined;
  const toUnicodeRef = font.get("ToUnicode");
  if (toUnicodeRef !== undefined) {
    // An unreadable character map costs accuracy for one font, not the
    // document: decoding reports rather than throws, so the fallback to the
    // font's declared encoding is simply the else branch (INV-3).
    const stream = await resolveStream(doc, toUnicodeRef);
    if (stream) {
      const data = await doc.readStream(stream);
      if (data instanceof Uint8Array) toUnicode = parseToUnicode(data);
    }
  }

  // Simple fonts may override individual codes by glyph name.
  const table = baseEncodingTable(await baseEncodingName(doc, font));
  const encoding = await doc.dict(font.get("Encoding"));
  const differences = await doc.array(encoding?.get("Differences"));
  if (differences.length > 0) {
    let code = 0;
    for (const item of differences) {
      if (typeof item === "number") code = item;
      else if (isName(item)) table[code++] = glyphNameToText(item.name);
    }
  }

  return {
    twoByte,
    type3: subtypeName === "Type3",
    decode(bytes: Uint8Array): string {
      let out = "";
      const step = twoByte ? 2 : 1;
      for (let i = 0; i + step - 1 < bytes.length; i += step) {
        const code =
          step === 2
            ? ((bytes[i] as number) << 8) | (bytes[i + 1] as number)
            : (bytes[i] as number);
        const mapped = toUnicode?.get(code);
        if (mapped !== undefined && mapped !== "") {
          out += mapped;
          continue;
        }
        // Without a map, a composite font's codes are glyph indices with no
        // character meaning; guessing would invent text that isn't there.
        if (twoByte) continue;
        out += table[code] ?? "";
      }
      return out;
    },
  };
}

async function baseEncodingName(doc: PdfDocument, font: PdfDict): Promise<string | undefined> {
  const encoding = font.get("Encoding");
  const direct = await doc.resolve(encoding);
  if (isName(direct)) return direct.name;
  const dict = await doc.dict(encoding);
  const base = dict?.get("BaseEncoding");
  return isName(base) ? base.name : undefined;
}

async function resolveStream(doc: PdfDocument, value: PdfValue) {
  const object =
    typeof value === "object" && value !== null && "num" in value
      ? await doc.getObject((value as { num: number }).num)
      : undefined;
  return isStream(object) ? object : undefined;
}

/** Decode a PDF string for display when no font is selected at all. */
export const decodeLatin1 = (bytes: Uint8Array): string => latin1(bytes);
