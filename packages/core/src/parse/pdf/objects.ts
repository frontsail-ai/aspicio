/**
 * The PDF object model and its lexer (PDF-2).
 *
 * PDF's syntax is shared by two very different things: the file's object
 * graph, and the content streams that draw. One lexer serves both — content
 * streams are just operands followed by an operator keyword — so this module
 * stays free of any notion of pages or drawing.
 */

/** A `/Name`. Wrapped so it never collides with a string operand. */
export interface PdfName {
  readonly name: string;
}

/** An indirect reference, `12 0 R`. */
export interface PdfRef {
  readonly num: number;
  readonly gen: number;
}

/** A PDF string: bytes, not text — the encoding depends on where it is used. */
export interface PdfString {
  readonly bytes: Uint8Array;
}

/** A bare keyword: `obj`, `stream`, or a content-stream operator like `re`. */
export interface PdfKeyword {
  readonly op: string;
}

export type PdfDict = Map<string, PdfValue>;

export type PdfValue =
  | number
  | boolean
  | null
  | PdfName
  | PdfRef
  | PdfString
  | PdfKeyword
  | PdfDict
  | PdfValue[];

export const isName = (v: PdfValue | undefined): v is PdfName =>
  typeof v === "object" && v !== null && "name" in v;
export const isRef = (v: PdfValue | undefined): v is PdfRef =>
  typeof v === "object" && v !== null && "num" in v && "gen" in v;
export const isString = (v: PdfValue | undefined): v is PdfString =>
  typeof v === "object" && v !== null && "bytes" in v;
export const isKeyword = (v: PdfValue | undefined): v is PdfKeyword =>
  typeof v === "object" && v !== null && "op" in v;
export const isDict = (v: PdfValue | undefined): v is PdfDict => v instanceof Map;

/** Numeric coercion for values that may be missing or the wrong type. */
export const toNumber = (v: PdfValue | undefined, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/* ---------- character classes (PDF 32000-1 §7.2.2) ---------- */

const isWhite = (b: number): boolean =>
  b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;

const isDelimiter = (b: number): boolean =>
  b === 0x28 || // (
  b === 0x29 || // )
  b === 0x3c || // <
  b === 0x3e || // >
  b === 0x5b || // [
  b === 0x5d || // ]
  b === 0x7b || // {
  b === 0x7d || // }
  b === 0x2f || // /
  b === 0x25; // %

const isRegular = (b: number): boolean => !isWhite(b) && !isDelimiter(b);

const hexDigit = (b: number): number => {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x37;
  if (b >= 0x61 && b <= 0x66) return b - 0x57;
  return -1;
};

/** Decode bytes as Latin-1 — PDF syntax is byte-oriented, never UTF-8. */
export function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i] as number);
  return out;
}

/**
 * A cursor over PDF syntax.
 *
 * Nesting is bounded: a malformed file must fail as a parse error rather than
 * exhaust the stack, and real documents nest only a handful of levels.
 */
export class PdfLexer {
  pos: number;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array, pos = 0) {
    this.bytes = bytes;
    this.pos = pos;
  }

  get atEnd(): boolean {
    return this.pos >= this.bytes.length;
  }

  /** Skip whitespace and comments. */
  skipSpace(): void {
    for (;;) {
      while (this.pos < this.bytes.length && isWhite(this.bytes[this.pos] as number)) this.pos++;
      if (this.bytes[this.pos] === 0x25) {
        while (
          this.pos < this.bytes.length &&
          this.bytes[this.pos] !== 0x0a &&
          this.bytes[this.pos] !== 0x0d
        )
          this.pos++;
      } else return;
    }
  }

  /** Read one bare token — a keyword, a number, or a single delimiter. */
  readToken(): string {
    this.skipSpace();
    const start = this.pos;
    while (this.pos < this.bytes.length && isRegular(this.bytes[this.pos] as number)) this.pos++;
    if (this.pos === start) this.pos++;
    return latin1(this.bytes, start, this.pos);
  }

  private readName(): PdfName {
    this.pos++; // '/'
    const start = this.pos;
    while (this.pos < this.bytes.length && isRegular(this.bytes[this.pos] as number)) this.pos++;
    const raw = latin1(this.bytes, start, this.pos);
    // #xx escapes are rare but legal in names, including in font resource keys.
    return {
      name: raw.includes("#")
        ? raw.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
        : raw,
    };
  }

  private readLiteralString(): PdfString {
    this.pos++; // '('
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.bytes.length) {
      const c = this.bytes[this.pos++] as number;
      if (c === 0x5c) {
        const n = this.bytes[this.pos++] as number;
        switch (n) {
          case 0x6e:
            out.push(0x0a);
            break; // \n
          case 0x72:
            out.push(0x0d);
            break; // \r
          case 0x74:
            out.push(0x09);
            break; // \t
          case 0x62:
            out.push(0x08);
            break; // \b
          case 0x66:
            out.push(0x0c);
            break; // \f
          case 0x0a:
            break; // line continuation
          case 0x0d:
            if (this.bytes[this.pos] === 0x0a) this.pos++;
            break;
          default:
            if (n >= 0x30 && n <= 0x37) {
              let oct = n - 0x30;
              for (let i = 0; i < 2; i++) {
                const d = this.bytes[this.pos] as number;
                if (d >= 0x30 && d <= 0x37) {
                  oct = oct * 8 + (d - 0x30);
                  this.pos++;
                } else break;
              }
              out.push(oct & 0xff);
            } else out.push(n);
        }
        continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29 && --depth === 0) break;
      out.push(c);
    }
    return { bytes: Uint8Array.from(out) };
  }

  private readHexString(): PdfString {
    this.pos++; // '<'
    const digits: number[] = [];
    while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0x3e) {
      const d = hexDigit(this.bytes[this.pos++] as number);
      if (d >= 0) digits.push(d);
    }
    this.pos++; // '>'
    if (digits.length % 2 === 1) digits.push(0); // an odd trailing digit means low nibble 0
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++)
      out[i] = (digits[2 * i] as number) * 16 + (digits[2 * i + 1] as number);
    return { bytes: out };
  }

  /**
   * Parse one object. Returns keywords as values so a content-stream reader
   * can drive the same loop as the object graph.
   */
  parseObject(depth = 0): PdfValue {
    if (depth > MAX_DEPTH) throw new PdfSyntaxError("PDF object nesting is too deep");
    this.skipSpace();
    if (this.atEnd) return null;
    const c = this.bytes[this.pos] as number;

    if (c === 0x2f) return this.readName();
    if (c === 0x28) return this.readLiteralString();

    if (c === 0x5b) {
      this.pos++;
      const arr: PdfValue[] = [];
      for (;;) {
        this.skipSpace();
        if (this.atEnd) break;
        if (this.bytes[this.pos] === 0x5d) {
          this.pos++;
          break;
        }
        const before = this.pos;
        arr.push(this.parseObject(depth + 1));
        if (this.pos === before) this.pos++; // never spin on a byte we can't read
      }
      return arr;
    }

    if (c === 0x3c) {
      if (this.bytes[this.pos + 1] !== 0x3c) return this.readHexString();
      this.pos += 2;
      const dict: PdfDict = new Map();
      for (;;) {
        this.skipSpace();
        if (this.atEnd) break;
        if (this.bytes[this.pos] === 0x3e && this.bytes[this.pos + 1] === 0x3e) {
          this.pos += 2;
          break;
        }
        const before = this.pos;
        const key = this.parseObject(depth + 1);
        if (!isName(key)) {
          if (this.pos === before) this.pos++;
          continue; // a stray value where a key belongs: skip it, keep the dict
        }
        dict.set(key.name, this.parseObject(depth + 1));
      }
      return dict;
    }

    // number, reference, boolean, null, or an operator keyword
    const start = this.pos;
    const tok = this.readToken();
    if (tok === "") {
      this.pos = start + 1;
      return null;
    }
    if (NUMBER_RE.test(tok)) {
      const asInt = /^\d+$/.test(tok);
      if (asInt) {
        // "num gen R" is only a reference when all three parts are present.
        const afterFirst = this.pos;
        const second = this.readToken();
        if (/^\d+$/.test(second)) {
          const afterSecond = this.pos;
          if (this.readToken() === "R")
            return { num: parseInt(tok, 10), gen: parseInt(second, 10) };
          this.pos = afterSecond;
        }
        this.pos = afterFirst;
      }
      return parseFloat(tok);
    }
    if (tok === "true") return true;
    if (tok === "false") return false;
    if (tok === "null") return null;
    return { op: tok };
  }
}

const MAX_DEPTH = 64;
// PDF numbers allow a leading sign and a bare leading/trailing dot.
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** A malformed-syntax failure, surfaced to callers as a parse error. */
export class PdfSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfSyntaxError";
  }
}

/** Find the first occurrence of an ASCII needle at or after `from`. */
export function indexOfAscii(haystack: Uint8Array, needle: string, from = 0): number {
  const pat = Array.from(needle, (ch) => ch.charCodeAt(0));
  outer: for (let i = Math.max(0, from); i <= haystack.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) if (haystack[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

/** Find the last occurrence of an ASCII needle at or before `from`. */
export function lastIndexOfAscii(haystack: Uint8Array, needle: string, from?: number): number {
  const pat = Array.from(needle, (ch) => ch.charCodeAt(0));
  const start = Math.min(from ?? haystack.length - pat.length, haystack.length - pat.length);
  outer: for (let i = start; i >= 0; i--) {
    for (let j = 0; j < pat.length; j++) if (haystack[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}
