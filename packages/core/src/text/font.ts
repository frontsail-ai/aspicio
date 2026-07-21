import type { Point2 } from "../model/types.ts";

/**
 * Single-stroke vector font for rendering DXF text as polylines — the same
 * approach CAD uses (SHX stroke fonts), so text flows through the existing
 * line-batching renderer with no glyph triangulation or webfonts.
 *
 * Data: the public-domain Hershey "futural" (Simplex Roman) set, ASCII 32-126,
 * base64-encoded to survive the backslash/backtick coordinate characters.
 * Format per line: cols 0-4 ignored, cols 5-7 = vertex count, then coordinate
 * pairs (char - 'R'); a leading space starts a new stroke (pen up); the first
 * pair is the left/right spacing bounds.
 * Source: github.com/kamalmostafa/hershey-fonts (futural.jhf).
 */
const FONT_B64 =
  "MTIzNDUgIDFKWgoxMjM0NSAgOU1XUkZSVCBSUllRWlJbU1pSWQoxMjM0NSAgNkpaTkZOTSBSVkZWTQoxMjM0NSAxMkhdU0JMYiBSWUJSYiBSTE9aTyBSS1VZVQoxMjM0NSAyN0hcUEJQXyBSVEJUXyBSWUlXR1RGUEZNR0tJS0tMTU1OT09VUVdSWFNZVVlYV1pUW1BbTVpLWAoxMjM0NSAzMkZeW0ZJWyBSTkZQSFBKT0xNTUtNSUtJSUpHTEZORlBHU0hWSFlHW0YgUldUVVVUV1RZVltYW1paW1hbVllUV1QKMTIzNDUgMzVFX1xPXE5bTVpNWU5YUFZVVFhSWlBbTFtKWklZSFdIVUlTSlJRTlJNU0tTSVJHUEZOR01JTUtOTlBRVVhXWllbW1tcWlxZCjEyMzQ1ICA4TVdSSFFHUkZTR1NJUktRTAoxMjM0NSAxMUtZVkJURFJHUEtPUE9UUFlSXVRgVmIKMTIzNDUgMTFLWU5CUERSR1RLVVBVVFRZUl1QYE5iCjEyMzQ1ICA5SlpSTFJYIFJNT1dVIFJXT01VCjEyMzQ1ICA2RV9SSVJbIFJJUltSCjEyMzQ1ICA4TlZTV1JYUVdSVlNXU1lRWwoxMjM0NSAgM0VfSVJbUgoxMjM0NSAgNk5WUlZRV1JYU1dSVgoxMjM0NSAgM0ddW0JJYgoxMjM0NSAxOEhcUUZOR0xKS09LUkxXTlpRW1NbVlpYV1lSWU9YSlZHU0ZRRgoxMjM0NSAgNUhcTkpQSVNGU1sKMTIzNDUgMTVIXExLTEpNSE5HUEZURlZHV0hYSlhMV05VUUtbWVsKMTIzNDUgMTZIXE1GWEZSTlVOV09YUFlTWVVYWFZaU1tQW01aTFlLVwoxMjM0NSAgN0hcVUZLVFpUIFJVRlVbCjEyMzQ1IDE4SFxXRk1GTE9NTlBNU01WTlhQWVNZVVhYVlpTW1BbTVpMWUtXCjEyMzQ1IDI0SFxYSVdHVEZSRk9HTUpMT0xUTVhPWlJbU1tWWlhYWVVZVFhRVk9TTlJOT09NUUxUCjEyMzQ1ICA2SFxZRk9bIFJLRllGCjEyMzQ1IDMwSFxQRk1HTElMS01NT05TT1ZQWFJZVFlXWFlXWlRbUFtNWkxZS1dLVExSTlBRT1VOV01YS1hJV0dURlBGCjEyMzQ1IDI0SFxYTVdQVVJSU1FTTlJMUEtNS0xMSU5HUUZSRlVHV0lYTVhSV1dVWlJbUFtNWkxYCjEyMzQ1IDEyTlZST1FQUlFTUFJPIFJSVlFXUlhTV1JWCjEyMzQ1IDE0TlZST1FQUlFTUFJPIFJTV1JYUVdSVlNXU1lRWwoxMjM0NSAgNEZeWklKUlpbCjEyMzQ1ICA2RV9JT1tPIFJJVVtVCjEyMzQ1ICA0Rl5KSVpSSlsKMTIzNDUgMjFJW0xLTEpNSE5HUEZURlZHV0hYSlhMV05WT1JRUlQgUlJZUVpSW1NaUlkKMTIzNDUgNTZFYFdOVkxUS1FLT0xOTU1QTVNOVVBWU1ZVVVZTIFJRS09NTlBOU09VUFYgUldLVlNWVVhWWlZcVF1RXU9cTFtKWUhXR1RGUUZOR0xISkpJTEhPSFJJVUpXTFlOWlFbVFtXWllZWlggUlhLV1NXVVhWCjEyMzQ1ICA5SVtSRkpbIFJSRlpbIFJNVFdUCjEyMzQ1IDI0R1xLRktbIFJLRlRGV0dYSFlKWUxYTldPVFAgUktQVFBXUVhSWVRZV1hZV1pUW0tbCjEyMzQ1IDE5SF1aS1lJV0dVRlFGT0dNSUxLS05LU0xWTVhPWlFbVVtXWllYWlYKMTIzNDUgMTZHXEtGS1sgUktGUkZVR1dJWEtZTllTWFZXWFVaUltLWwoxMjM0NSAxMkhbTEZMWyBSTEZZRiBSTFBUUCBSTFtZWwoxMjM0NSAgOUhaTEZMWyBSTEZZRiBSTFBUUAoxMjM0NSAyM0hdWktZSVdHVUZRRk9HTUlMS0tOS1NMVk1YT1pRW1VbV1pZWFpWWlMgUlVTWlMKMTIzNDUgIDlHXUtGS1sgUllGWVsgUktQWVAKMTIzNDUgIDNOVlJGUlsKMTIzNDUgMTFKWlZGVlZVWVRaUltQW05aTVlMVkxUCjEyMzQ1ICA5R1xLRktbIFJZRktUIFJQT1lbCjEyMzQ1ICA2SFlMRkxbIFJMW1hbCjEyMzQ1IDEyRl5KRkpbIFJKRlJbIFJaRlJbIFJaRlpbCjEyMzQ1ICA5R11LRktbIFJLRllbIFJZRllbCjEyMzQ1IDIyR11QRk5HTElLS0pOSlNLVkxYTlpQW1RbVlpYWFlWWlNaTllLWElWR1RGUEYKMTIzNDUgMTRHXEtGS1sgUktGVEZXR1hIWUpZTVhPV1BUUUtRCjEyMzQ1IDI1R11QRk5HTElLS0pOSlNLVkxYTlpQW1RbVlpYWFlWWlNaTllLWElWR1RGUEYgUlNXWV0KMTIzNDUgMTdHXEtGS1sgUktGVEZXR1hIWUpZTFhOV09UUEtQIFJSUFlbCjEyMzQ1IDIxSFxZSVdHVEZQRk1HS0lLS0xNTU5PT1VRV1JYU1lVWVhXWlRbUFtNWktYCjEyMzQ1ICA2SlpSRlJbIFJLRllGCjEyMzQ1IDExR11LRktVTFhOWlFbU1tWWlhYWVVZRgoxMjM0NSAgNklbSkZSWyBSWkZSWwoxMjM0NSAxMkZeSEZNWyBSUkZNWyBSUkZXWyBSXEZXWwoxMjM0NSAgNkhcS0ZZWyBSWUZLWwoxMjM0NSAgN0lbSkZSUFJbIFJaRlJQCjEyMzQ1ICA5SFxZRktbIFJLRllGIFJLW1lbCjEyMzQ1IDEyS1lPQk9iIFJQQlBiIFJPQlZCIFJPYlZiCjEyMzQ1ICAzS1lLRlleCjEyMzQ1IDEyS1lUQlRiIFJVQlViIFJOQlVCIFJOYlViCjEyMzQ1ICA2SlpSREpSIFJSRFpSCjEyMzQ1ICAzSVtJYltiCjEyMzQ1ICA4TlZTS1FNUU9SUFNPUk5RTwoxMjM0NSAxOElcWE1YWyBSWFBWTlRNUU1PTk1QTFNMVU1YT1pRW1RbVlpYWAoxMjM0NSAxOEhbTEZMWyBSTFBOTlBNU01VTldQWFNYVVdYVVpTW1BbTlpMWAoxMjM0NSAxNUlbWFBWTlRNUU1PTk1QTFNMVU1YT1pRW1RbVlpYWAoxMjM0NSAxOElcWEZYWyBSWFBWTlRNUU1PTk1QTFNMVU1YT1pRW1RbVlpYWAoxMjM0NSAxOElbTFNYU1hRV09WTlRNUU1PTk1QTFNMVU1YT1pRW1RbVlpYWAoxMjM0NSAgOU1ZV0ZVRlNHUkpSWyBST01WTQoxMjM0NSAyM0lcWE1YXVdgVmFUYlFiT2EgUlhQVk5UTVFNT05NUExTTFVNWE9aUVtUW1ZaWFgKMTIzNDUgMTFJXE1GTVsgUk1RUE5STVVNV05YUVhbCjEyMzQ1ICA5TlZRRlJHU0ZSRVFGIFJSTVJbCjEyMzQ1IDEyTVdSRlNHVEZTRVJGIFJTTVNeUmFQYk5iCjEyMzQ1ICA5SVpNRk1bIFJXTU1XIFJRU1hbCjEyMzQ1ICAzTlZSRlJbCjEyMzQ1IDE5Q2FHTUdbIFJHUUpOTE1PTVFOUlFSWyBSUlFVTldNWk1cTl1RXVsKMTIzNDUgMTFJXE1NTVsgUk1RUE5STVVNV05YUVhbCjEyMzQ1IDE4SVxRTU9OTVBMU0xVTVhPWlFbVFtWWlhYWVVZU1hQVk5UTVFNCjEyMzQ1IDE4SFtMTUxiIFJMUE5OUE1TTVVOV1BYU1hVV1hVWlNbUFtOWkxYCjEyMzQ1IDE4SVxYTVhiIFJYUFZOVE1RTU9OTVBMU0xVTVhPWlFbVFtWWlhYCjEyMzQ1ICA5S1hPTU9bIFJPU1BQUk5UTVdNCjEyMzQ1IDE4SltYUFdOVE1RTU5OTVBOUlBTVVRXVVhXWFhXWlRbUVtOWk1YCjEyMzQ1ICA5TVlSRlJXU1pVW1dbIFJPTVZNCjEyMzQ1IDExSVxNTU1XTlpQW1NbVVpYVyBSWE1YWwoxMjM0NSAgNkpaTE1SWyBSWE1SWwoxMjM0NSAxMkddSk1OWyBSUk1OWyBSUk1WWyBSWk1WWwoxMjM0NSAgNkpbTU1YWyBSWE1NWwoxMjM0NSAxMEpaTE1SWyBSWE1SW1BfTmFMYktiCjEyMzQ1ICA5SltYTU1bIFJNTVhNIFJNW1hbCjEyMzQ1IDQwS1lUQlJDUURQRlBIUUpSS1NNU09RUSBSUkNRRVFHUklTSlRMVE5TUE9SU1RUVlRYU1pSW1FdUV9SYSBSUVNTVVNXUllRWlBcUF5RYFJhVGIKMTIzNDUgIDNOVlJCUmIKMTIzNDUgNDBLWVBCUkNTRFRGVEhTSlJLUU1RT1NRIFJSQ1NFU0dSSVFKUExQTlFQVVJRVFBWUFhRWlJbU11TX1JhIFJTU1FVUVdSWVNaVFxUXlNgUmFQYgoxMjM0NSAyNEZeSVVJU0pQTE9OT1BQVFNWVFhUWlNbUSBSSVNKUUxQTlBQUVRUVlVYVVpUW1FbTwoxMjM0NSAzNUpaSkZKW0tbS0ZMRkxbTVtNRk5GTltPW09GUEZQW1FbUUZSRlJbU1tTRlRGVFtVW1VGVkZWW1dbV0ZYRlhbWVtZRlpGWlsK";

/** Hershey cap height (top of capitals to baseline): 'I' spans y = -12..9. */
export const FONT_CAP_HEIGHT = 21;

export interface Glyph {
  /** Polylines in font units; y is DOWN (Hershey convention). */
  strokes: Point2[][];
  /** Horizontal advance in font units. */
  advance: number;
  /** Left bound in font units (glyphs are drawn relative to it). */
  left: number;
}

const decodeBase64 = (b64: string): string =>
  typeof atob === "function"
    ? atob(b64)
    : // Node/bun fallback if atob is unavailable.
      Buffer.from(b64, "base64").toString("binary");

let lines: string[] | null = null;
const cache = new Map<number, Glyph>();

function fontLines(): string[] {
  if (!lines)
    lines = decodeBase64(FONT_B64)
      .split("\n")
      .filter((l) => l.length > 0);
  return lines;
}

function decodeGlyph(line: string): Glyph {
  const nvert = parseInt(line.slice(5, 8), 10);
  const data = line.slice(8);
  const left = data.charCodeAt(0) - 82;
  const right = data.charCodeAt(1) - 82;
  const strokes: Point2[][] = [];
  let current: Point2[] = [];
  for (let i = 1; i < nvert; i++) {
    if (data[2 * i] === " ") {
      if (current.length) strokes.push(current);
      current = [];
      continue;
    }
    current.push({ x: data.charCodeAt(2 * i) - 82, y: data.charCodeAt(2 * i + 1) - 82 });
  }
  if (current.length) strokes.push(current);
  return { strokes, advance: right - left, left };
}

/** Sample a full circle as a closed polyline (font units, y down). */
function circleStroke(cx: number, cy: number, r: number, segments = 12): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/**
 * Glyphs the Hershey ASCII table lacks but CAD text needs — the %%-code
 * symbols ° ± Ø (PARSE-9). Coordinates follow the font convention:
 * baseline at y=9, cap top at y=-12, y down.
 */
const SYNTHETIC = new Map<number, () => Glyph>([
  // ° — small circle hugging the cap top.
  [0xb0, () => ({ strokes: [circleStroke(0, -8, 3.5)], advance: 11, left: -5.5 })],
  // ± — plus sign with a bar beneath.
  [
    0xb1,
    () => ({
      strokes: [
        [
          { x: 0, y: -10 },
          { x: 0, y: 2 },
        ],
        [
          { x: -5, y: -4 },
          { x: 5, y: -4 },
        ],
        [
          { x: -5, y: 6 },
          { x: 5, y: 6 },
        ],
      ],
      advance: 14,
      left: -7,
    }),
  ],
  // Ø — the letter O with a slash through it.
  [
    0xd8,
    () => {
      const o = glyph(0x4f);
      let minX = Infinity;
      let maxX = -Infinity;
      for (const stroke of o.strokes)
        for (const p of stroke) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
        }
      const slash: Point2[] = [
        { x: minX - 1, y: 11 },
        { x: maxX + 1, y: -14 },
      ];
      return { strokes: [...o.strokes, slash], advance: o.advance, left: o.left };
    },
  ],
]);

/** Glyph for a character code, or the space glyph for unmapped codes. */
export function glyph(charCode: number): Glyph {
  const index = charCode - 32;
  const all = fontLines();
  const line = index >= 0 && index < all.length ? all[index] : all[0];
  let g = cache.get(charCode);
  if (!g) {
    g = SYNTHETIC.get(charCode)?.() ?? decodeGlyph(line);
    cache.set(charCode, g);
  }
  return g;
}
