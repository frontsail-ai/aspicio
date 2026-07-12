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
