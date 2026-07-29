/**
 * The content-stream interpreter (PDF-3).
 *
 * Walks drawing operators and emits the same entity types DXF produces, so
 * everything below parse stays format-blind. What it cannot draw it counts
 * (PDF-8) — the interpreter never fails a file, it only ever draws less.
 */

import { sampleCubic } from "../../geom/bezier.ts";
import { DEFAULT_CURVE_SEGMENTS } from "../../geom/arc.ts";
import type {
  Entity,
  HatchEntity,
  LineTypeDef,
  Point2,
  PolylineEntity,
  TextEntity,
} from "../../model/types.ts";
import { isStream } from "./document.ts";
import type { PdfDocument } from "./document.ts";
import { PdfLexer, isKeyword, isName, isRef, isString, toNumber } from "./objects.ts";
import { buildFontDecoder } from "./text.ts";
import type { FontDecoder } from "./text.ts";
import type { PdfDict, PdfValue } from "./objects.ts";

/** The single layer PDF content lands on until OCG support arrives (PDF-7). */
export const CONTENT_LAYER = "Content";

/** 1 pt = 25.4/72 mm, and lineweights are stored in 1/100 mm. */
const POINTS_TO_LINEWEIGHT = 2540 / 72;

/** Bound on form recursion; a cyclic form graph must not hang the parse. */
const MAX_FORM_DEPTH = 12;

/** A 2×3 affine matrix, PDF's `[a b c d e f]`. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m × n` — apply `m` first, then `n`, matching PDF's `cm` semantics. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export const apply = (m: Matrix, x: number, y: number): Point2 => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

/**
 * The matrix's average scale factor.
 *
 * Line width is a scalar in user space but the transform may scale the axes
 * differently; the geometric mean is the standard compromise and matches what
 * a renderer shows for a uniformly scaled drawing exactly.
 */
export function matrixScale(m: Matrix): number {
  const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
  return Math.sqrt(det) || Math.hypot(m[0], m[1]) || 1;
}

/* ---------- colour ---------- */

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
const rgb = (r: number, g: number, b: number): number =>
  (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);

/** Naive CMYK → RGB, which is what a viewer without colour management can do. */
export const cmykToRgb = (c: number, m: number, y: number, k: number): number =>
  rgb((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));

export const grayToRgb = (g: number): number => rgb(g, g, g);

/* ---------- graphics state ---------- */

interface GraphicsState {
  ctm: Matrix;
  strokeColor: number;
  fillColor: number;
  lineWidth: number;
  dash: number[];
  /** Selected font resource name, inherited by forms this state invokes. */
  fontName?: string;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  /** Horizontal scale, as a fraction (`Tz` is a percentage). */
  horizontalScale: number;
  leading: number;
  rise: number;
}

const initialState = (ctm: Matrix): GraphicsState => ({
  ctm,
  strokeColor: 0x000000,
  fillColor: 0x000000,
  lineWidth: 1,
  dash: [],
  fontSize: 0,
  charSpacing: 0,
  wordSpacing: 0,
  horizontalScale: 1,
  leading: 0,
  rise: 0,
});

const cloneState = (s: GraphicsState): GraphicsState => ({ ...s, dash: [...s.dash] });

/** What one page's interpretation produced. */
export interface InterpretResult {
  entities: Entity[];
  /** Synthesized dash patterns, keyed by the name the entities reference. */
  lineTypes: Map<string, LineTypeDef>;
  /** Per-kind counts of what was skipped (PDF-8). */
  unsupported: Record<string, number>;
}

export interface InterpretOptions {
  /** Segments per full circle when flattening curves. */
  curveSegments?: number;
}

/**
 * Interpret one page's content into entities.
 *
 * `baseCtm` lets a caller place the page; the identity leaves content in PDF
 * user space, which is already y-up like DXF (PDF-6).
 */
export async function interpretContent(
  doc: PdfDocument,
  content: Uint8Array,
  resources: PdfDict | undefined,
  options: InterpretOptions = {},
  baseCtm: Matrix = IDENTITY,
): Promise<InterpretResult> {
  const run = new Interpreter(doc, options.curveSegments ?? DEFAULT_CURVE_SEGMENTS);
  await run.execute(content, resources, baseCtm, 0);
  return { entities: run.entities, lineTypes: run.lineTypes, unsupported: run.unsupported };
}

class Interpreter {
  readonly entities: Entity[] = [];
  readonly lineTypes = new Map<string, LineTypeDef>();
  readonly unsupported: Record<string, number> = {};
  private readonly dashNames = new Map<string, string>();
  // Building a decoder parses a CMap, so one per font object rather than per
  // text run: the Ghent corpus has 101 of them across 3,438 text operators.
  private readonly decoders = new Map<string, FontDecoder>();
  private readonly decoderSalt = 0;

  private readonly doc: PdfDocument;
  private readonly curveSegments: number;

  // Explicit fields rather than constructor parameter properties: the example
  // apps compile core from source under `erasableSyntaxOnly`, which rejects
  // the shorthand.
  constructor(doc: PdfDocument, curveSegments: number) {
    this.doc = doc;
    this.curveSegments = curveSegments;
  }

  private count(kind: string): void {
    this.unsupported[kind] = (this.unsupported[kind] ?? 0) + 1;
  }

  async execute(
    content: Uint8Array,
    resources: PdfDict | undefined,
    ctm: Matrix,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_FORM_DEPTH) return;

    const stack: GraphicsState[] = [];
    let state = initialState(ctm);
    let operands: PdfValue[] = [];

    // Current path, in device space: each subpath is a run of points.
    let subpaths: Point2[][] = [];
    let current: Point2[] = [];
    let startPoint: Point2 | undefined;
    let cursor: Point2 = { x: 0, y: 0 };
    let pendingClip = false;

    // Text object state: PDF keeps two matrices, one for the whole object and
    // one that advances per glyph run.
    let textMatrix: Matrix = IDENTITY;
    let lineMatrix: Matrix = IDENTITY;

    const num = (i: number): number => toNumber(operands[operands.length - i]);
    const flushSubpath = (): void => {
      if (current.length > 1) subpaths.push(current);
      current = [];
    };
    const resetPath = (): void => {
      flushSubpath();
      if (pendingClip) {
        // Clipping is honored by counting, not by cropping: a fill may escape
        // the region its producer intended (PDF-8).
        this.count("Clip");
        pendingClip = false;
      }
      subpaths = [];
      startPoint = undefined;
    };
    const moveTo = (x: number, y: number): void => {
      flushSubpath();
      cursor = apply(state.ctm, x, y);
      startPoint = cursor;
      current = [cursor];
    };
    const lineTo = (x: number, y: number): void => {
      cursor = apply(state.ctm, x, y);
      current.push(cursor);
    };
    const curveTo = (c1: Point2, c2: Point2, end: Point2): void => {
      const p0 = cursor;
      const a = apply(state.ctm, c1.x, c1.y);
      const b = apply(state.ctm, c2.x, c2.y);
      const p3 = apply(state.ctm, end.x, end.y);
      if (current.length === 0) current.push(p0);
      current.push(...sampleCubic(p0, a, b, p3, this.curveSegments));
      cursor = p3;
    };

    const lexer = new PdfLexer(content);
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
        if (operands.length > 128) operands = operands.slice(-32);
        continue;
      }

      switch (value.op) {
        /* --- graphics state --- */
        case "q":
          stack.push(cloneState(state));
          break;
        case "Q":
          state = stack.pop() ?? state;
          break;
        case "cm":
          state.ctm = multiply([num(6), num(5), num(4), num(3), num(2), num(1)], state.ctm);
          break;
        case "w":
          state.lineWidth = num(1);
          break;
        case "d": {
          const pattern = operands[operands.length - 2];
          state.dash = Array.isArray(pattern) ? pattern.map((v) => toNumber(v)) : [];
          break;
        }
        case "gs":
          await this.applyExtGState(operands[operands.length - 1], resources, state);
          break;

        /* --- colour --- */
        case "RG":
          state.strokeColor = rgb(num(3), num(2), num(1));
          break;
        case "rg":
          state.fillColor = rgb(num(3), num(2), num(1));
          break;
        case "K":
          state.strokeColor = cmykToRgb(num(4), num(3), num(2), num(1));
          break;
        case "k":
          state.fillColor = cmykToRgb(num(4), num(3), num(2), num(1));
          break;
        case "G":
          state.strokeColor = grayToRgb(num(1));
          break;
        case "g":
          state.fillColor = grayToRgb(num(1));
          break;
        case "SC":
        case "SCN":
        case "sc":
        case "scn": {
          // Component counts identify the space well enough to colour with;
          // a pattern operand names a pattern instead, which we count.
          const stroking = value.op === "SC" || value.op === "SCN";
          const nums = operands.filter((o) => typeof o === "number") as number[];
          if (operands.some((o) => isName(o))) this.count("PatternFill");
          else if (nums.length === 1) {
            const c = grayToRgb(nums[0] as number);
            if (stroking) state.strokeColor = c;
            else state.fillColor = c;
          } else if (nums.length === 3) {
            const c = rgb(nums[0] as number, nums[1] as number, nums[2] as number);
            if (stroking) state.strokeColor = c;
            else state.fillColor = c;
          } else if (nums.length === 4) {
            const c = cmykToRgb(
              nums[0] as number,
              nums[1] as number,
              nums[2] as number,
              nums[3] as number,
            );
            if (stroking) state.strokeColor = c;
            else state.fillColor = c;
          }
          break;
        }

        /* --- path construction --- */
        case "m":
          moveTo(num(2), num(1));
          break;
        case "l":
          lineTo(num(2), num(1));
          break;
        case "c":
          curveTo({ x: num(6), y: num(5) }, { x: num(4), y: num(3) }, { x: num(2), y: num(1) });
          break;
        case "v": {
          // First control point is the current point.
          const inv = this.inverse(state.ctm, cursor);
          curveTo(inv, { x: num(4), y: num(3) }, { x: num(2), y: num(1) });
          break;
        }
        case "y":
          curveTo({ x: num(4), y: num(3) }, { x: num(2), y: num(1) }, { x: num(2), y: num(1) });
          break;
        case "re": {
          const x = num(4);
          const y = num(3);
          const w = num(2);
          const h = num(1);
          flushSubpath();
          const corners = [
            apply(state.ctm, x, y),
            apply(state.ctm, x + w, y),
            apply(state.ctm, x + w, y + h),
            apply(state.ctm, x, y + h),
          ];
          subpaths.push([...corners, corners[0] as Point2]);
          cursor = corners[0] as Point2;
          startPoint = cursor;
          break;
        }
        case "h":
          if (current.length > 1 && startPoint) current.push(startPoint);
          break;

        /* --- path painting --- */
        case "S":
        case "s": {
          if (value.op === "s" && current.length > 1 && startPoint) current.push(startPoint);
          flushSubpath();
          this.emitStrokes(subpaths, state);
          resetPath();
          break;
        }
        case "f":
        case "F":
        case "f*":
          flushSubpath();
          this.emitFill(subpaths, state);
          resetPath();
          break;
        case "B":
        case "B*":
        case "b":
        case "b*": {
          if ((value.op === "b" || value.op === "b*") && current.length > 1 && startPoint)
            current.push(startPoint);
          flushSubpath();
          this.emitFill(subpaths, state);
          this.emitStrokes(subpaths, state);
          resetPath();
          break;
        }
        case "n":
          resetPath();
          break;
        case "W":
        case "W*":
          pendingClip = true;
          break;

        /* --- external objects --- */
        case "Do":
          await this.drawXObject(operands[operands.length - 1], resources, state, depth);
          break;
        case "sh":
          this.count("Shading");
          break;
        case "BI":
          this.count("Image");
          lexer.pos = skipInlineImage(content, lexer.pos);
          break;

        /* --- text (PDF-4) --- */
        case "BT":
          textMatrix = IDENTITY;
          lineMatrix = IDENTITY;
          break;
        case "ET":
          break;
        case "Tf": {
          const name = operands[operands.length - 2];
          state.fontName = isName(name) ? name.name : undefined;
          state.fontSize = num(1);
          break;
        }
        case "Td":
          lineMatrix = multiply([1, 0, 0, 1, num(2), num(1)], lineMatrix);
          textMatrix = lineMatrix;
          break;
        case "TD":
          state.leading = -num(1);
          lineMatrix = multiply([1, 0, 0, 1, num(2), num(1)], lineMatrix);
          textMatrix = lineMatrix;
          break;
        case "Tm":
          lineMatrix = [num(6), num(5), num(4), num(3), num(2), num(1)];
          textMatrix = lineMatrix;
          break;
        case "T*":
          lineMatrix = multiply([1, 0, 0, 1, 0, -state.leading], lineMatrix);
          textMatrix = lineMatrix;
          break;
        case "TL":
          state.leading = num(1);
          break;
        case "Tc":
          state.charSpacing = num(1);
          break;
        case "Tw":
          state.wordSpacing = num(1);
          break;
        case "Tz":
          state.horizontalScale = num(1) / 100;
          break;
        case "Ts":
          state.rise = num(1);
          break;
        case "Tj":
        case "'":
        case '"': {
          if (value.op !== "Tj") {
            // Both quote operators start a new line first; `"` also sets spacing.
            if (value.op === '"') {
              state.wordSpacing = num(3);
              state.charSpacing = num(2);
            }
            lineMatrix = multiply([1, 0, 0, 1, 0, -state.leading], lineMatrix);
            textMatrix = lineMatrix;
          }
          const shown = operands[operands.length - 1];
          if (isString(shown))
            textMatrix = await this.showText(shown.bytes, state, textMatrix, resources);
          break;
        }
        case "TJ": {
          const items = operands[operands.length - 1];
          if (!Array.isArray(items)) break;
          for (const item of items) {
            if (isString(item))
              textMatrix = await this.showText(item.bytes, state, textMatrix, resources);
            else if (typeof item === "number") {
              // A number displaces the next glyph, in thousandths of an em.
              const shift = (-item / 1000) * state.fontSize * state.horizontalScale;
              textMatrix = multiply([1, 0, 0, 1, shift, 0], textMatrix);
            }
          }
          break;
        }

        default:
          break;
      }
      operands = [];
    }
  }

  /** Map a device-space point back through the CTM, for `v`'s implicit control point. */
  private inverse(m: Matrix, p: Point2): Point2 {
    const det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) return { x: 0, y: 0 };
    const dx = p.x - m[4];
    const dy = p.y - m[5];
    return { x: (dx * m[3] - dy * m[2]) / det, y: (dy * m[0] - dx * m[1]) / det };
  }

  /**
   * Emit one text run and advance the text matrix.
   *
   * Position, size, and rotation all come from the combined text and
   * transformation matrices — PDF has no notion of a text "insertion point"
   * separate from its matrix, so everything is derived rather than read.
   */
  private async showText(
    bytes: Uint8Array,
    state: GraphicsState,
    textMatrix: Matrix,
    resources: PdfDict | undefined,
  ): Promise<Matrix> {
    const decoder = await this.fontDecoder(state.fontName, resources);
    const text = decoder ? decoder.decode(bytes) : "";

    // The rendering matrix: text space scaled by font size, then placed.
    const scaled: Matrix = [
      state.fontSize * state.horizontalScale,
      0,
      0,
      state.fontSize,
      0,
      state.rise,
    ];
    const render = multiply(multiply(scaled, textMatrix), state.ctm);

    if (text !== "") {
      const position = { x: render[4], y: render[5] };
      // Cap height, not em size: the stroke font draws caps at `height`, and
      // 0.7 em is the usual cap-height ratio for text faces.
      const height = Math.hypot(render[2], render[3]) * 0.7;
      // render[0] already carries the horizontal scale, so divide it back out
      // or a stretched run would report a skewed angle.
      const rotation = Math.atan2(render[1], render[0] / (state.horizontalScale || 1));
      // Tz stretches glyphs horizontally; the stroke font honours it directly.
      const widthFactor = state.horizontalScale > 0 ? state.horizontalScale : 1;
      if (height > 0) {
        const entity: TextEntity = {
          type: "TEXT",
          layer: CONTENT_LAYER,
          color: state.fillColor,
          position,
          text,
          height,
          rotation,
          widthFactor,
          hAlign: "left",
          vAlign: "baseline",
        };
        this.entities.push(entity);
      }
    }

    // Advance by the run's width. Without glyph metrics the estimate is the
    // standard half-em average, which keeps successive runs from stacking on
    // one another — exact advance needs /Widths, which is 1.5 work.
    const glyphs = decoder?.twoByte === true ? bytes.length / 2 : bytes.length;
    const spaces = decoder?.twoByte === true ? 0 : countSpaces(bytes);
    const width =
      (glyphs * 0.5 * state.fontSize + glyphs * state.charSpacing + spaces * state.wordSpacing) *
      state.horizontalScale;
    return multiply([1, 0, 0, 1, width, 0], textMatrix);
  }

  /** Resolve and cache a font resource's decoder. */
  private async fontDecoder(
    name: string | undefined,
    resources: PdfDict | undefined,
  ): Promise<FontDecoder | undefined> {
    if (name === undefined) return undefined;
    const fonts = await this.doc.dict(resources?.get("Font"));
    const ref = fonts?.get(name);
    if (ref === undefined) return undefined;
    const key = isRef(ref) ? `#${ref.num}` : `${name}@${this.decoderSalt}`;
    const cached = this.decoders.get(key);
    if (cached) return cached;
    const font = await this.doc.dict(ref);
    if (!font) return undefined;
    const decoder = await buildFontDecoder(this.doc, font);
    this.decoders.set(key, decoder);
    return decoder;
  }

  private emitStrokes(subpaths: Point2[][], state: GraphicsState): void {
    const scale = matrixScale(state.ctm);
    // A zero width means "thinnest line the device can draw" — hairline, which
    // is what an undefined lineWeight already means downstream.
    const width = state.lineWidth * scale;
    const lineWeight = width > 0 ? Math.round(width * POINTS_TO_LINEWEIGHT) : undefined;
    const lineType = this.dashLineType(state.dash, scale);
    for (const points of subpaths) {
      if (points.length < 2) continue;
      const entity: PolylineEntity = {
        type: "POLYLINE",
        layer: CONTENT_LAYER,
        color: state.strokeColor,
        points,
        bulges: points.map(() => 0),
        closed: false,
        ...(lineWeight === undefined ? {} : { lineWeight }),
        ...(lineType === undefined ? {} : { lineType }),
      };
      this.entities.push(entity);
    }
  }

  /**
   * Emit fills for one path's subpaths.
   *
   * A single paint operator can fill disjoint regions as easily as a shape
   * with holes — `re re f` is everyday output. Treating the first subpath as
   * the outer boundary and everything else as holes silently drops the second
   * region, which is invisible wrongness rather than honest incompleteness.
   * So rings are grouped by containment: every ring nobody contains becomes
   * its own filled region, carrying the rings nested inside it as holes.
   */
  private emitFill(subpaths: Point2[][], state: GraphicsState): void {
    const rings = subpaths.filter((points) => points.length >= 3);
    if (rings.length === 0) return;
    if (rings.length === 1) {
      this.pushHatch(rings, state);
      return;
    }

    const boxes = rings.map(boundingBox);
    // The innermost ring containing each one — its parent in the nesting tree.
    const parent = rings.map((_, i) => {
      let best = -1;
      for (let j = 0; j < rings.length; j++) {
        if (j === i || !contains(boxes[j] as Box, boxes[i] as Box)) continue;
        if (best < 0 || area(boxes[j] as Box) < area(boxes[best] as Box)) best = j;
      }
      return best;
    });

    // Depth decides role: a ring nested an odd number of levels deep is a hole
    // in its parent; an even depth starts a new filled region.
    const depth = rings.map((_, i) => {
      let d = 0;
      for (let at = parent[i] as number; at >= 0; at = parent[at] as number) {
        d++;
        if (d > rings.length) break; // containment cannot cycle, but be safe
      }
      return d;
    });

    const groups = new Map<number, Point2[][]>();
    for (const [i, ring] of rings.entries()) {
      if ((depth[i] as number) % 2 === 0) {
        if (!groups.has(i)) groups.set(i, [ring]);
      } else {
        const owner = parent[i] as number;
        const list = groups.get(owner);
        if (list) list.push(ring);
        else groups.set(owner, [rings[owner] as Point2[], ring]);
      }
    }
    for (const loops of groups.values()) this.pushHatch(loops, state);
  }

  private pushHatch(loops: Point2[][], state: GraphicsState): void {
    const entity: HatchEntity = {
      type: "HATCH",
      layer: CONTENT_LAYER,
      color: state.fillColor,
      // First loop is the outer boundary, the rest are holes — the same
      // convention DXF fills use (PDF-3).
      loops,
      solid: true,
    };
    this.entities.push(entity);
  }

  /**
   * Turn a dash array into a named linetype the existing resolution machinery
   * understands: positive runs draw, negative runs gap.
   */
  private dashLineType(dash: number[], scale: number): string | undefined {
    const scaled = dash.map((d) => d * scale).filter((d) => Number.isFinite(d));
    if (scaled.every((d) => d === 0)) return undefined; // also covers the empty array
    const key = scaled.join(",");
    const existing = this.dashNames.get(key);
    if (existing) return existing;

    const name = `__dash_${this.dashNames.size}`;
    const pattern: number[] = [];
    for (let i = 0; i < scaled.length; i++) {
      const value = Math.abs(scaled[i] as number);
      // PDF alternates on/off starting with on; DXF signs them.
      pattern.push(i % 2 === 0 ? value : -value);
    }
    // An odd-length PDF array repeats with phase inverted; doubling it makes
    // the pattern self-consistent for a renderer that just cycles.
    if (pattern.length % 2 === 1) pattern.push(...pattern.map((p) => -p));
    this.lineTypes.set(name, {
      name,
      pattern,
      patternLength: pattern.reduce((sum, p) => sum + Math.abs(p), 0),
    });
    this.dashNames.set(key, name);
    return name;
  }

  private async applyExtGState(
    nameValue: PdfValue | undefined,
    resources: PdfDict | undefined,
    state: GraphicsState,
  ): Promise<void> {
    if (!isName(nameValue)) return;
    const states = await this.doc.dict(resources?.get("ExtGState"));
    const gs = await this.doc.dict(states?.get(nameValue.name));
    if (!gs) return;
    if (gs.has("SMask")) {
      const mask = gs.get("SMask");
      // /None turns masking off — only an actual mask is unsupported.
      if (!(isName(mask) && mask.name === "None")) this.count("SoftMask");
    }
    // ExtGState can also set line width and dash; honour them rather than
    // letting a file that styles strokes this way draw hairlines silently.
    const lw = gs.get("LW");
    if (typeof lw === "number") state.lineWidth = lw;
    const dash = await this.doc.array(gs.get("D"));
    if (dash.length > 0) {
      const pattern = await this.doc.array(dash[0]);
      state.dash = pattern.map((v) => toNumber(v));
    }
    const blend = gs.get("BM");
    const blendName = isName(blend)
      ? blend.name
      : Array.isArray(blend) && isName(blend[0])
        ? blend[0].name
        : undefined;
    if (blendName !== undefined && blendName !== "Normal" && blendName !== "Compatible")
      this.count("BlendMode");
  }

  private async drawXObject(
    nameValue: PdfValue | undefined,
    resources: PdfDict | undefined,
    state: GraphicsState,
    depth: number,
  ): Promise<void> {
    if (!isName(nameValue)) return;
    const xobjects = await this.doc.dict(resources?.get("XObject"));
    const ref = xobjects?.get(nameValue.name);
    const object = isRef(ref) ? await this.doc.getObject(ref.num) : undefined;
    if (!isStream(object)) return;

    const subtype = object.dict.get("Subtype");
    if (isName(subtype) && subtype.name === "Image") {
      this.count("Image");
      return;
    }
    if (!isName(subtype) || subtype.name !== "Form") return;

    // A form whose bytes cannot be decompressed at all must cost that form,
    // not the page: the interpreter never fails a file, it only draws less
    // (PDF-8, INV-3). Reachable by hostile input, which the corpus is not.
    let decoded: Awaited<ReturnType<typeof this.doc.readStream>>;
    try {
      decoded = await this.doc.readStream(object);
    } catch {
      this.count("UndecodableStream");
      return;
    }
    if (!(decoded instanceof Uint8Array)) return;
    // A form's own /Matrix places it inside its parent's space.
    const matrixValue = await this.doc.array(object.dict.get("Matrix"));
    const matrix: Matrix =
      matrixValue.length === 6
        ? (matrixValue.map((v) => toNumber(v)) as unknown as Matrix)
        : IDENTITY;
    const formResources = (await this.doc.dict(object.dict.get("Resources"))) ?? resources;
    await this.execute(decoded, formResources, multiply(matrix, state.ctm), depth + 1);
  }
}

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function boundingBox(points: readonly Point2[]): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** True when `outer` encloses `inner`. Bounding boxes are enough here: a ring
 * that is not box-contained cannot be geometrically contained either, and the
 * false positives (interlocking L-shapes) are rarer than the disjoint case
 * this exists to get right. */
function contains(outer: Box, inner: Box): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY &&
    area(outer) > area(inner)
  );
}

const area = (b: Box): number => Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);

/** Count ASCII spaces, which are what word spacing applies to. */
function countSpaces(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) if (b === 0x20) n++;
  return n;
}

/** Position after an inline image's `EI`, given the position after `BI`. */
function skipInlineImage(content: Uint8Array, from: number): number {
  for (let i = from; i < content.length - 1; i++) {
    if (content[i] !== 0x45 || content[i + 1] !== 0x49) continue;
    const after = content[i + 2];
    if (after === undefined || after <= 0x20) return i + 2;
  }
  return content.length;
}
