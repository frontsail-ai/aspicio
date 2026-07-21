import type { Point2 } from "../model/types.ts";
import { FONT_CAP_HEIGHT, glyph } from "./font.ts";

/** Baseline is at Hershey y = 9 (bottom of capitals). */
const BASELINE = 9;

export type HAlign = "left" | "center" | "right";
export type VAlign = "baseline" | "bottom" | "middle" | "top";

export interface TextLayoutOptions {
  /** Cap height in drawing units. */
  height: number;
  /** Horizontal scale (DXF xScale; MTEXT is 1). Default 1. */
  widthFactor?: number;
  hAlign?: HAlign;
  vAlign?: VAlign;
  /** Line spacing as a multiple of height. Default 1.5. */
  lineSpacing?: number;
}

const H_FRACTION: Record<HAlign, number> = { left: 0, center: 0.5, right: 1 };

// Sentinels for escaped literals, protected from the directive-stripping
// passes. Control-char values that cannot occur in DXF text.
const BSL = String.fromCharCode(1);
const LBR = String.fromCharCode(2);
const RBR = String.fromCharCode(3);

/** Decode DXF \U+XXXX escapes (pre-2007 files store non-ANSI text this way). */
const decodeUnicodeEscapes = (s: string): string =>
  s.replace(/\\[Uu]\+([0-9A-Fa-f]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

/** TEXT-era %%-code → character (case-insensitive). */
const PERCENT_CHARS: Record<string, string> = { d: "°", p: "±", c: "Ø" };

/**
 * Decode legacy TEXT control sequences to plain content (PARSE-9):
 * %%d/%%p/%%c → °/±/Ø, %%u/%%o/%%k style toggles dropped, %%% → %,
 * %%nnn → character nnn, \U+XXXX unescaped, and the caret notation for
 * tab/newline normalized. Unknown %% sequences stay literal.
 */
export function decodeTextSpecials(raw: string): string {
  // Caret notation: only whitespace controls and the escaped caret itself —
  // decoding every "^x" pair (chr(x-64), as some CADs do) would corrupt
  // ordinary text like "x^2".
  let s = raw.replace(/\^([IJM ])/g, (_, ch: string) =>
    ch === " " ? "^" : String.fromCharCode(ch.charCodeAt(0) - 64),
  );
  s = decodeUnicodeEscapes(s);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "%" && s[i + 1] === "%" && i + 2 < s.length) {
      const code = s[i + 2].toLowerCase();
      const special = PERCENT_CHARS[code];
      if (special) {
        out += special;
        i += 2;
        continue;
      }
      if (code === "u" || code === "o" || code === "k") {
        i += 2; // underline/overline/strike-through toggle — plain text drops it
        continue;
      }
      if (code === "%") {
        out += "%";
        i += 2;
        continue;
      }
      const nnn = /^\d{3}/.exec(s.slice(i + 2));
      if (nnn) {
        out += String.fromCharCode(parseInt(nnn[0], 10));
        i += 4;
        continue;
      }
    }
    out += s[i];
  }
  return out;
}

/**
 * Collapse MTEXT inline formatting codes to plain text. Paragraph breaks
 * become newlines; font/height/color/alignment directives are dropped;
 * stacked fractions are flattened to "a/b". Best-effort — enough to read.
 */
export function stripMText(raw: string): string {
  let s = raw
    .replace(/\\\\/g, BSL) // escaped literal backslash
    .replace(/\\\{/g, LBR) // escaped literal braces
    .replace(/\\\}/g, RBR)
    .replace(/\\~/g, " ") // non-breaking space
    .replace(/\\P/g, "\n"); // paragraph break
  // Unescape \U+XXXX before directive stripping, which would otherwise eat
  // "\U+00B0…;" up to an unrelated semicolon.
  s = decodeUnicodeEscapes(s);
  // Stacked fractions: \S1^2; \S1/2; \S1#2; -> 1/2
  s = s.replace(/\\S([^;^/#]*)[\^/#]([^;]*);/g, "$1/$2");
  // Formatting directives carrying an argument up to ';'.
  s = s.replace(/\\[A-Za-z][^;\\]*;/g, "");
  // Single-letter toggles with no argument.
  s = s.replace(/\\[LlOoKkNX]/g, "");
  // Grouping braces.
  s = s.replace(/[{}]/g, "");
  return s.split(BSL).join("\\").split(LBR).join("{").split(RBR).join("}");
}

function lineWidth(line: string, scale: number, widthFactor: number): number {
  let advance = 0;
  for (let i = 0; i < line.length; i++) advance += glyph(line.charCodeAt(i)).advance;
  return advance * scale * widthFactor;
}

/**
 * Lay out text as stroke polylines around the insertion point (origin),
 * y-up and unrotated. The caller applies the entity's rotation and position.
 */
export function layoutText(text: string, options: TextLayoutOptions): Point2[][] {
  const {
    height,
    widthFactor = 1,
    hAlign = "left",
    vAlign = "baseline",
    lineSpacing = 1.5,
  } = options;
  const scale = height / FONT_CAP_HEIGHT;
  const lineHeight = height * lineSpacing;
  const lines = text.split("\n");

  // Vertical anchor: first line's baseline sits at y0; lines flow downward.
  const blockTop = height; // cap top of the first line, above its baseline
  const blockBottom = -(lines.length - 1) * lineHeight; // last line's baseline
  let y0 = 0;
  if (vAlign === "top") y0 = -blockTop;
  else if (vAlign === "bottom") y0 = -blockBottom;
  else if (vAlign === "middle") y0 = -(blockTop + blockBottom) / 2;

  const out: Point2[][] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const baseY = y0 - li * lineHeight;
    const width = lineWidth(line, scale, widthFactor);
    let penX = -width * H_FRACTION[hAlign];
    for (let ci = 0; ci < line.length; ci++) {
      const g = glyph(line.charCodeAt(ci));
      for (const stroke of g.strokes) {
        const poly: Point2[] = [];
        for (const p of stroke) {
          poly.push({
            x: penX + (p.x - g.left) * scale * widthFactor,
            y: baseY + (BASELINE - p.y) * scale,
          });
        }
        out.push(poly);
      }
      penX += g.advance * scale * widthFactor;
    }
  }
  return out;
}
