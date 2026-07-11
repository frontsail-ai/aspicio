import type { Bounds, Point2 } from "../model/types.ts";

/**
 * 2D camera state: world center, zoom (world units per CSS pixel), and
 * rotation (radians; positive rotates content CCW on screen).
 */
export class Camera2D {
  center: Point2 = { x: 0, y: 0 };
  unitsPerPixel = 1;
  rotation = 0;
  viewportWidth = 1;
  viewportHeight = 1;

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }

  /** Fit bounds into the viewport with relative padding. */
  fit(bounds: Bounds, padding = 0.05): void {
    const w = Math.max(bounds.maxX - bounds.minX, 1e-9);
    const h = Math.max(bounds.maxY - bounds.minY, 1e-9);
    this.center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    this.rotation = 0;
    this.unitsPerPixel = Math.max(
      w / (this.viewportWidth * (1 - padding * 2)),
      h / (this.viewportHeight * (1 - padding * 2)),
    );
  }

  /** World-space direction of the screen X axis. */
  private rightAxis(): Point2 {
    return { x: Math.cos(this.rotation), y: -Math.sin(this.rotation) };
  }

  /** World-space direction of the screen "up" (negative screen Y). */
  private upAxis(): Point2 {
    return { x: Math.sin(this.rotation), y: Math.cos(this.rotation) };
  }

  /** Convert viewport pixel coordinates (y down) to world coordinates. */
  screenToWorld(px: number, py: number): Point2 {
    const sx = (px - this.viewportWidth / 2) * this.unitsPerPixel;
    const sy = (this.viewportHeight / 2 - py) * this.unitsPerPixel;
    const right = this.rightAxis();
    const up = this.upAxis();
    return {
      x: this.center.x + sx * right.x + sy * up.x,
      y: this.center.y + sx * right.y + sy * up.y,
    };
  }

  /** Pan so content follows a pointer drag of (dx, dy) pixels. */
  panPixels(dx: number, dy: number): void {
    const right = this.rightAxis();
    const up = this.upAxis();
    const sx = dx * this.unitsPerPixel;
    const sy = -dy * this.unitsPerPixel;
    this.center.x -= sx * right.x + sy * up.x;
    this.center.y -= sx * right.y + sy * up.y;
  }

  /** Zoom by `factor` (>1 zooms in), keeping the world point under (px, py) fixed. */
  zoomAt(px: number, py: number, factor: number): void {
    const anchor = this.screenToWorld(px, py);
    this.unitsPerPixel /= factor;
    this.moveAnchor(anchor, px, py);
  }

  /** Rotate by `dAngle`, keeping the world point under (px, py) fixed. */
  rotateAround(px: number, py: number, dAngle: number): void {
    const anchor = this.screenToWorld(px, py);
    this.rotation += dAngle;
    this.moveAnchor(anchor, px, py);
  }

  /** Re-center so `anchor` (world) lands exactly at pixel (px, py). */
  private moveAnchor(anchor: Point2, px: number, py: number): void {
    const sx = (px - this.viewportWidth / 2) * this.unitsPerPixel;
    const sy = (this.viewportHeight / 2 - py) * this.unitsPerPixel;
    const right = this.rightAxis();
    const up = this.upAxis();
    this.center.x = anchor.x - sx * right.x - sy * up.x;
    this.center.y = anchor.y - sx * right.y - sy * up.y;
  }
}
