/**
 * Custom VIEWPORT parser for dxf-parser (which has no built-in handler).
 * A paper-space VIEWPORT is a window that shows model space at a fixed
 * scale; we read its paper rectangle and the model view it frames so the
 * model can be transformed and clipped into the sheet.
 */

interface RawGroup {
  code: number;
  value: number | string | boolean;
}

export interface RawViewport {
  type: "VIEWPORT";
  layer?: string;
  inPaperSpace: boolean;
  /** Viewport id (code 69); id 1 is the paper-space "overall" viewport. */
  id: number;
  /** Center on the paper (codes 10/20). */
  centerX: number;
  centerY: number;
  /** Paper-space width/height (codes 40/41). */
  width: number;
  height: number;
  /** View center in display coords (codes 12/22). */
  viewCenterX: number;
  viewCenterY: number;
  /** View target in world/model coords (codes 17/27) — preferred. */
  viewTargetX?: number;
  viewTargetY?: number;
  /** Model-space height visible in the viewport (code 45) — drives the scale. */
  viewHeight: number;
  /** View twist, degrees (code 51). */
  twistDeg: number;
}

const num = (v: number | string | boolean): number => (typeof v === "number" ? v : Number(v));

export class ViewportHandler {
  ForEntityName = "VIEWPORT" as const;

  parseEntity(scanner: { next(): RawGroup; isEOF(): boolean }, _curr: RawGroup): RawViewport {
    const e: RawViewport = {
      type: "VIEWPORT",
      inPaperSpace: false,
      id: 0,
      centerX: 0,
      centerY: 0,
      width: 0,
      height: 0,
      viewCenterX: 0,
      viewCenterY: 0,
      viewHeight: 1,
      twistDeg: 0,
    };
    let g = scanner.next();
    while (!scanner.isEOF() && g.code !== 0) {
      switch (g.code) {
        case 8:
          e.layer = String(g.value);
          break;
        case 67:
          e.inPaperSpace = num(g.value) === 1;
          break;
        case 10:
          e.centerX = num(g.value);
          break;
        case 20:
          e.centerY = num(g.value);
          break;
        case 40:
          e.width = num(g.value);
          break;
        case 41:
          e.height = num(g.value);
          break;
        case 12:
          e.viewCenterX = num(g.value);
          break;
        case 22:
          e.viewCenterY = num(g.value);
          break;
        case 17:
          e.viewTargetX = num(g.value);
          break;
        case 27:
          e.viewTargetY = num(g.value);
          break;
        case 45:
          e.viewHeight = num(g.value);
          break;
        case 51:
          e.twistDeg = num(g.value);
          break;
        case 69:
          e.id = num(g.value);
          break;
      }
      g = scanner.next();
    }
    return e;
  }
}
