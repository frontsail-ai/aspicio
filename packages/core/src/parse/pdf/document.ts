/**
 * The PDF object graph: cross-references, indirect objects, streams, and the
 * page tree (PDF-2).
 *
 * Everything above this layer sees a resolved graph and never touches file
 * offsets. Every accessor is async because inflating a stream is.
 */

import { DrawingParseError } from "../errors.ts";
import { decodeStream, isUndecoded } from "./filters.ts";
import type { UndecodedStream } from "./filters.ts";
import {
  PdfLexer,
  PdfSyntaxError,
  indexOfAscii,
  isDict,
  isName,
  isRef,
  lastIndexOfAscii,
  latin1,
  toNumber,
} from "./objects.ts";
import type { PdfDict, PdfValue } from "./objects.ts";

/** This parser's format name, as carried by its errors (PARSE-13). */
export const PDF_FORMAT = "pdf";

/** A stream object: its dictionary plus the still-encoded bytes. */
export interface PdfStream {
  readonly dict: PdfDict;
  readonly raw: Uint8Array;
}

export const isStream = (v: unknown): v is PdfStream =>
  typeof v === "object" && v !== null && "dict" in v && "raw" in v;

/** Where an object lives: at a file offset, or inside an object stream. */
type XrefEntry =
  | { readonly kind: "offset"; readonly offset: number }
  | { readonly kind: "in-object-stream"; readonly stream: number; readonly index: number };

interface ObjectStreamIndex {
  readonly data: Uint8Array;
  readonly first: number;
  readonly offsets: ReadonlyMap<number, number>;
}

/** Bound on `/Prev` chains and page-tree depth: malformed files must not hang. */
const MAX_CHAIN = 64;
const MAX_TREE_DEPTH = 64;

export class PdfDocument {
  private readonly bytes: Uint8Array;
  private readonly xref = new Map<number, XrefEntry>();
  private readonly trailers: PdfDict[] = [];
  private readonly objects = new Map<number, PdfValue | PdfStream>();
  private readonly objectStreams = new Map<number, ObjectStreamIndex>();
  // The gate reads every content stream, then the interpreter reads them
  // again; without this the whole document inflates twice.
  private readonly decoded = new WeakMap<PdfStream, Uint8Array | UndecodedStream>();

  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  static async parse(bytes: Uint8Array): Promise<PdfDocument> {
    const doc = new PdfDocument(bytes);
    try {
      await doc.readXrefChain();
    } catch (error) {
      if (error instanceof DrawingParseError) throw error;
      if (error instanceof PdfSyntaxError) throw pdfError(error.message);
      throw pdfError("Not a readable PDF file");
    }
    if (doc.xref.size === 0) throw pdfError("Not a readable PDF file");
    return doc;
  }

  /** Trailer entries, newest section first. */
  trailerValue(key: string): PdfValue | undefined {
    for (const trailer of this.trailers) {
      const value = trailer.get(key);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  /** Resolve one level of indirection. */
  async resolve(value: PdfValue | undefined): Promise<PdfValue | undefined> {
    if (!isRef(value)) return value;
    const object = await this.getObject(value.num);
    return isStream(object) ? object.dict : object;
  }

  /** Resolve to a dictionary, or undefined when the value is anything else. */
  async dict(value: PdfValue | undefined): Promise<PdfDict | undefined> {
    const resolved = await this.resolve(value);
    return isDict(resolved) ? resolved : undefined;
  }

  /** Resolve to an array; a lone value becomes a one-element array. */
  async array(value: PdfValue | undefined): Promise<PdfValue[]> {
    const resolved = await this.resolve(value);
    if (resolved === undefined || resolved === null) return [];
    return Array.isArray(resolved) ? resolved : [resolved];
  }

  async getObject(num: number): Promise<PdfValue | PdfStream | undefined> {
    const cached = this.objects.get(num);
    if (cached !== undefined) return cached;
    const entry = this.xref.get(num);
    if (!entry) return undefined;

    const value =
      entry.kind === "offset"
        ? this.readObjectAt(entry.offset, num)
        : await this.readFromObjectStream(entry.stream, num);
    if (value !== undefined) this.objects.set(num, value);
    return value;
  }

  /** Decode a stream's bytes, or report the image codec that stopped us. */
  async readStream(stream: PdfStream): Promise<Uint8Array | UndecodedStream> {
    const cached = this.decoded.get(stream);
    if (cached !== undefined) return cached;
    const result = await decodeStream(stream.raw, stream.dict, (v) => this.resolveSync(v));
    this.decoded.set(stream, result);
    return result;
  }

  /**
   * The stream objects backing a page's content, before decoding.
   *
   * Callers that need to inspect the stream dictionaries — rather than the
   * bytes — use this; `pageContent` is the decoded form.
   */
  async contentStreams(page: PdfDict): Promise<PdfStream[]> {
    const contents = page.get("Contents");
    let refs: PdfValue[];
    if (isRef(contents)) {
      const target = await this.getObject(contents.num);
      refs = isStream(target) ? [contents] : Array.isArray(target) ? target : [];
    } else refs = Array.isArray(contents) ? contents : [];

    const out: PdfStream[] = [];
    for (const ref of refs) {
      const object = isRef(ref) ? await this.getObject(ref.num) : undefined;
      if (isStream(object)) out.push(object);
    }
    return out;
  }

  /* ---------- pages ---------- */

  /**
   * Every page, in document order.
   *
   * Inheritable attributes (`/Resources`, `/MediaBox`, `/Rotate`) are folded
   * down from ancestors, because a page that omits them means "use my
   * parent's" — not "I have none".
   */
  async pages(): Promise<PdfDict[]> {
    const root = await this.dict(this.trailerValue("Root"));
    const pagesNode = root?.get("Pages");
    const out: PdfDict[] = [];
    const seen = new Set<number>();
    await this.collectPages(pagesNode, new Map(), out, seen, 0);
    return out;
  }

  private async collectPages(
    node: PdfValue | undefined,
    inherited: ReadonlyMap<string, PdfValue>,
    out: PdfDict[],
    seen: Set<number>,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_TREE_DEPTH) return;
    // A page tree can be a cycle in a corrupt file; visiting a node twice is
    // the only symptom we get.
    if (isRef(node)) {
      if (seen.has(node.num)) return;
      seen.add(node.num);
    }
    const dict = await this.dict(node);
    if (!dict) return;

    const merged = new Map(inherited);
    for (const key of INHERITABLE) {
      const own = dict.get(key);
      if (own !== undefined) merged.set(key, own);
    }

    const type = dict.get("Type");
    const kids = dict.get("Kids");
    if ((isName(type) && type.name === "Page") || (kids === undefined && dict.has("Contents"))) {
      const page: PdfDict = new Map(dict);
      for (const [key, value] of merged) if (!page.has(key)) page.set(key, value);
      out.push(page);
      return;
    }
    for (const kid of await this.array(kids))
      await this.collectPages(kid, merged, out, seen, depth + 1);
  }

  /**
   * A page's content, decoded and concatenated.
   *
   * `/Contents` is a stream, an array of streams, or a reference to either —
   * page 1 of the Ghent X-4 suite is an eight-part array. The parts join with
   * a newline because a lexical token may not span the join (PDF 32000-1
   * §7.7.3.3): without a separator, a trailing `0` and a leading `0` would
   * read as a single `00`.
   */
  async pageContent(page: PdfDict): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    for (const stream of await this.contentStreams(page)) {
      const decoded = await this.readStream(stream);
      if (isUndecoded(decoded)) continue;
      parts.push(decoded, NEWLINE);
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  /* ---------- cross-reference reading ---------- */

  private async readXrefChain(): Promise<void> {
    let offset = this.findStartXref();
    const visited = new Set<number>();
    for (let i = 0; i < MAX_CHAIN && offset !== undefined; i++) {
      if (visited.has(offset)) break;
      visited.add(offset);
      offset = await this.readXrefSection(offset);
    }
    // A file whose cross-reference table is unusable can still be read by
    // scanning for `N G obj` headers; damaged PDFs in the wild are common
    // enough that failing outright would be the wrong call.
    if (this.xref.size === 0 || this.trailers.length === 0) this.recoverByScan();
  }

  private findStartXref(): number | undefined {
    const at = lastIndexOfAscii(this.bytes, "startxref");
    if (at < 0) return undefined;
    const lexer = new PdfLexer(this.bytes, at + "startxref".length);
    const value = parseInt(lexer.readToken(), 10);
    return Number.isFinite(value) && value >= 0 && value < this.bytes.length ? value : undefined;
  }

  /** Read one section; returns its `/Prev` offset when the chain continues. */
  private async readXrefSection(offset: number): Promise<number | undefined> {
    const lexer = new PdfLexer(this.bytes, offset);
    lexer.skipSpace();
    const start = lexer.pos;
    if (lexer.readToken() === "xref") return await this.readXrefTable(lexer);
    lexer.pos = start;
    return await this.readXrefStream(lexer);
  }

  private async readXrefTable(lexer: PdfLexer): Promise<number | undefined> {
    for (;;) {
      lexer.skipSpace();
      const save = lexer.pos;
      const token = lexer.readToken();
      if (token === "trailer") break;
      const first = parseInt(token, 10);
      const count = parseInt(lexer.readToken(), 10);
      if (!Number.isFinite(first) || !Number.isFinite(count)) {
        lexer.pos = save;
        break;
      }
      for (let i = 0; i < count; i++) {
        const entryOffset = parseInt(lexer.readToken(), 10);
        lexer.readToken(); // generation
        const kind = lexer.readToken();
        const num = first + i;
        // Earlier sections must not overwrite newer ones: the newest
        // definition of an object wins, and we read newest first.
        if (kind === "n" && !this.xref.has(num) && Number.isFinite(entryOffset))
          this.xref.set(num, { kind: "offset", offset: entryOffset });
      }
    }

    const trailer = lexer.parseObject();
    if (!isDict(trailer)) return undefined;
    this.trailers.push(trailer);
    // A hybrid file keeps a second, stream-based table for newer readers.
    const hybrid = trailer.get("XRefStm");
    if (typeof hybrid === "number") await this.readXrefSection(hybrid);
    const prev = trailer.get("Prev");
    return typeof prev === "number" ? prev : undefined;
  }

  private async readXrefStream(lexer: PdfLexer): Promise<number | undefined> {
    lexer.readToken(); // object number
    lexer.readToken(); // generation
    if (lexer.readToken() !== "obj") return undefined;
    const dict = lexer.parseObject();
    if (!isDict(dict)) return undefined;
    const raw = this.readStreamBytes(lexer, dict);
    if (!raw) return undefined;
    const decoded = await decodeStream(raw, dict, (v) => this.resolveSync(v));
    if (isUndecoded(decoded)) return undefined;

    const widths = (Array.isArray(dict.get("W")) ? (dict.get("W") as PdfValue[]) : []).map((w) =>
      toNumber(w),
    );
    if (widths.length < 3) return undefined;
    const size = toNumber(dict.get("Size"));
    const indexValue = dict.get("Index");
    const index = Array.isArray(indexValue) ? indexValue.map((v) => toNumber(v)) : [0, size];
    const rowLength = widths.reduce((a, b) => a + b, 0);

    let pos = 0;
    for (let s = 0; s + 1 < index.length; s += 2) {
      const first = index[s] as number;
      const count = index[s + 1] as number;
      for (let i = 0; i < count && pos + rowLength <= decoded.length; i++) {
        const fields: (number | undefined)[] = [];
        for (const width of widths) {
          if (width === 0) {
            fields.push(undefined);
            continue;
          }
          let value = 0;
          for (let k = 0; k < width; k++) value = value * 256 + (decoded[pos++] as number);
          fields.push(value);
        }
        const num = first + i;
        if (this.xref.has(num)) continue;
        // A zero-width type field defaults to 1 (in-file), per the spec.
        const type = fields[0] ?? 1;
        const second = fields[1] ?? 0;
        if (type === 1) this.xref.set(num, { kind: "offset", offset: second });
        else if (type === 2)
          this.xref.set(num, { kind: "in-object-stream", stream: second, index: fields[2] ?? 0 });
      }
    }

    this.trailers.push(dict);
    const prev = dict.get("Prev");
    return typeof prev === "number" ? prev : undefined;
  }

  /**
   * Last resort: index every `N G obj` header in the file.
   *
   * Scans bytes rather than decoding the file into a string — recovery is
   * triggered by damage, and a damaged multi-megabyte upload is exactly where
   * materializing a second copy of the file would hurt.
   */
  private recoverByScan(): void {
    for (
      let at = indexOfAscii(this.bytes, "obj");
      at >= 0;
      at = indexOfAscii(this.bytes, "obj", at + 3)
    ) {
      // Walk back over " G " and "N" to find the header's start.
      let i = at - 1;
      while (i >= 0 && isAsciiSpace(this.bytes[i] as number)) i--;
      const genEnd = i;
      while (i >= 0 && isAsciiDigit(this.bytes[i] as number)) i--;
      if (i === genEnd) continue; // no generation number
      while (i >= 0 && isAsciiSpace(this.bytes[i] as number)) i--;
      const numEnd = i;
      while (i >= 0 && isAsciiDigit(this.bytes[i] as number)) i--;
      if (i === numEnd) continue; // no object number
      const start = i + 1;
      const num = parseInt(latin1(this.bytes, start, numEnd + 1), 10);
      // Recovery deliberately lets a *later* definition win, which is the
      // opposite of the newest-section-wins rule the cross-reference readers
      // use. Without a cross-reference table there is no section order to
      // trust — file order is the only signal, and an incremental update
      // appends, so the last copy in the file is the newest.
      if (Number.isFinite(num)) this.xref.set(num, { kind: "offset", offset: start });
    }
    const text = latin1(this.bytes.subarray(Math.max(0, this.bytes.length - 4096)));
    if (this.trailers.length === 0) {
      const tailStart = Math.max(0, this.bytes.length - 4096);
      const at = text.lastIndexOf("trailer");
      if (at >= 0) {
        const lexer = new PdfLexer(this.bytes, tailStart + at + "trailer".length);
        const trailer = lexer.parseObject();
        if (isDict(trailer)) this.trailers.push(trailer);
      }
    }
    if (this.trailers.length === 0) {
      // No trailer at all: synthesize one from the first /Type /Catalog found.
      for (const [num] of this.xref) {
        const object = this.readObjectAt((this.xref.get(num) as { offset: number }).offset, num);
        const candidate = isStream(object) ? object.dict : object;
        const type = isDict(candidate) ? candidate.get("Type") : undefined;
        if (isName(type) && type.name === "Catalog") {
          this.trailers.push(new Map<string, PdfValue>([["Root", { num, gen: 0 }]]));
          break;
        }
      }
    }
  }

  /* ---------- object reading ---------- */

  private readObjectAt(offset: number, expectedNum: number): PdfValue | PdfStream | undefined {
    if (offset < 0 || offset >= this.bytes.length) return undefined;
    const lexer = new PdfLexer(this.bytes, offset);
    const num = parseInt(lexer.readToken(), 10);
    lexer.readToken(); // generation
    if (lexer.readToken() !== "obj") return undefined;
    // A wrong offset that still lands on an object header would silently
    // return the wrong object; refuse instead.
    if (Number.isFinite(num) && num !== expectedNum) return undefined;

    const value = lexer.parseObject();
    const save = lexer.pos;
    lexer.skipSpace();
    if (isDict(value) && lexer.readToken() === "stream") {
      lexer.pos = save;
      const raw = this.readStreamBytes(lexer, value);
      if (raw) return { dict: value, raw };
    }
    return value;
  }

  /**
   * Slice a stream's bytes, starting after the `stream` keyword.
   *
   * `/Length` may be an indirect reference, and some producers write it
   * wrong, so the declared end is verified against the `endstream` keyword
   * and re-derived by search when it doesn't line up.
   */
  private readStreamBytes(lexer: PdfLexer, dict: PdfDict): Uint8Array | undefined {
    lexer.skipSpace();
    if (lexer.readToken() !== "stream") return undefined;
    // The keyword is followed by CRLF or LF — never CR alone.
    if (this.bytes[lexer.pos] === 0x0d) lexer.pos++;
    if (this.bytes[lexer.pos] === 0x0a) lexer.pos++;
    const start = lexer.pos;

    const declared = toNumber(this.resolveSync(dict.get("Length")), -1);
    let end = declared >= 0 ? start + declared : -1;
    if (end < start || end > this.bytes.length || !this.endstreamFollows(end)) {
      const found = indexOfAscii(this.bytes, "endstream", start);
      end = found < 0 ? this.bytes.length : found;
    }
    return this.bytes.subarray(start, end);
  }

  private endstreamFollows(end: number): boolean {
    const window = latin1(this.bytes, end, Math.min(this.bytes.length, end + 20));
    return /^[\s]*endstream/.test(window);
  }

  private async readFromObjectStream(
    streamNum: number,
    wantNum: number,
  ): Promise<PdfValue | undefined> {
    let index = this.objectStreams.get(streamNum);
    if (!index) {
      const container = await this.getObject(streamNum);
      if (!isStream(container)) return undefined;
      const decoded = await this.readStream(container);
      if (isUndecoded(decoded)) return undefined;
      const count = toNumber(this.resolveSync(container.dict.get("N")));
      const first = toNumber(this.resolveSync(container.dict.get("First")));
      const header = new PdfLexer(decoded, 0);
      const offsets = new Map<number, number>();
      for (let i = 0; i < count; i++) {
        const num = parseInt(header.readToken(), 10);
        const at = parseInt(header.readToken(), 10);
        if (Number.isFinite(num) && Number.isFinite(at)) offsets.set(num, at);
      }
      index = { data: decoded, first, offsets };
      this.objectStreams.set(streamNum, index);
    }
    const at = index.offsets.get(wantNum);
    if (at === undefined) return undefined;
    return new PdfLexer(index.data, index.first + at).parseObject();
  }

  /**
   * Resolve a reference that must already be readable without inflating —
   * `/Length` and filter parameters, which never live in object streams.
   */
  private resolveSync(value: PdfValue | undefined): PdfValue | undefined {
    if (!isRef(value)) return value;
    const cached = this.objects.get(value.num);
    if (cached !== undefined) return isStream(cached) ? cached.dict : cached;
    const entry = this.xref.get(value.num);
    if (!entry || entry.kind !== "offset") return undefined;
    const object = this.readObjectAt(entry.offset, value.num);
    return isStream(object) ? object.dict : object;
  }
}

const isAsciiDigit = (b: number): boolean => b >= 0x30 && b <= 0x39;
const isAsciiSpace = (b: number): boolean =>
  b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0c || b === 0x00;

const NEWLINE = Uint8Array.of(0x0a);
const INHERITABLE = ["Resources", "MediaBox", "CropBox", "Rotate"] as const;

/** A PDF failure phrased for a person, tagged with this parser's format. */
export function pdfError(message: string): DrawingParseError {
  return new DrawingParseError(message, PDF_FORMAT);
}
