import type { Camera2D } from "../camera/camera2d.ts";

export interface GestureOptions {
  /** Called after any camera change. */
  onChange: () => void;
  /** Called on double click / double tap (typically fit-to-view). */
  onReset?: () => void;
}

const WHEEL_ZOOM_SPEED = 0.0015;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DISTANCE = 30;

interface PointerState {
  x: number;
  y: number;
}

/**
 * Attach pointer-based camera gestures to an element.
 *
 * Desktop: drag = pan, wheel = zoom at cursor, Shift+drag = rotate.
 * Touch: one finger = pan, two fingers = pinch zoom + twist rotate + pan.
 *
 * Returns a detach function.
 */
export function attachGestures(
  element: HTMLElement,
  camera: Camera2D,
  options: GestureOptions,
): () => void {
  element.style.touchAction = "none";
  const pointers = new Map<number, PointerState>();
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: PointerEvent): void => {
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) and departed pointers have no capturable id.
    }
    const p = local(e);
    pointers.set(e.pointerId, p);

    if (pointers.size === 1 && e.pointerType === "touch") {
      const now = performance.now();
      if (
        now - lastTapTime < DOUBLE_TAP_MS &&
        Math.hypot(p.x - lastTapX, p.y - lastTapY) < DOUBLE_TAP_DISTANCE
      ) {
        lastTapTime = 0;
        options.onReset?.();
      } else {
        lastTapTime = now;
        lastTapX = p.x;
        lastTapY = p.y;
      }
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);

    if (pointers.size === 1) {
      if (e.shiftKey && e.pointerType === "mouse") {
        // Rotate around the viewport center.
        const cx = camera.viewportWidth / 2;
        const cy = camera.viewportHeight / 2;
        const anglePrev = Math.atan2(prev.y - cy, prev.x - cx);
        const angleCur = Math.atan2(cur.y - cy, cur.x - cx);
        camera.rotateAround(cx, cy, -(angleCur - anglePrev));
      } else {
        camera.panPixels(cur.x - prev.x, cur.y - prev.y);
      }
      pointers.set(e.pointerId, cur);
      options.onChange();
      return;
    }

    if (pointers.size === 2) {
      const ids = [...pointers.keys()];
      const otherId = ids[0] === e.pointerId ? ids[1] : ids[0];
      const other = pointers.get(otherId);
      if (!other) return;

      const midPrev = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
      const midCur = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
      const distPrev = Math.hypot(prev.x - other.x, prev.y - other.y);
      const distCur = Math.hypot(cur.x - other.x, cur.y - other.y);
      const anglePrev = Math.atan2(prev.y - other.y, prev.x - other.x);
      const angleCur = Math.atan2(cur.y - other.y, cur.x - other.x);

      camera.panPixels(midCur.x - midPrev.x, midCur.y - midPrev.y);
      if (distPrev > 1e-6 && distCur > 1e-6) {
        camera.zoomAt(midCur.x, midCur.y, distCur / distPrev);
      }
      // Screen Y is down, so visual CCW twist is a negative atan2 delta.
      camera.rotateAround(midCur.x, midCur.y, -(angleCur - anglePrev));

      pointers.set(e.pointerId, cur);
      options.onChange();
    }
  };

  const onPointerEnd = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = local(e);
    // Trackpad pinch arrives as ctrl+wheel; treat both as zoom.
    const speed = e.ctrlKey ? WHEEL_ZOOM_SPEED * 5 : WHEEL_ZOOM_SPEED;
    camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * speed));
    options.onChange();
  };

  const onDoubleClick = (e: MouseEvent): void => {
    e.preventDefault();
    options.onReset?.();
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerEnd);
  element.addEventListener("pointercancel", onPointerEnd);
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("dblclick", onDoubleClick);

  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerEnd);
    element.removeEventListener("pointercancel", onPointerEnd);
    element.removeEventListener("wheel", onWheel);
    element.removeEventListener("dblclick", onDoubleClick);
  };
}
