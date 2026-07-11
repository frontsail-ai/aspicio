// @vitest-environment happy-dom
import { expect, test, vi } from "vite-plus/test";
import { Camera2D } from "../src/camera/camera2d.ts";
import { attachGestures } from "../src/input/gestures.ts";

interface PointerInit {
  pointerId?: number;
  pointerType?: string;
  clientX?: number;
  clientY?: number;
  shiftKey?: boolean;
}

function firePointer(el: HTMLElement, type: string, init: PointerInit): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? "mouse",
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    shiftKey: init.shiftKey ?? false,
  });
  el.dispatchEvent(event);
}

/** happy-dom's WheelEvent drops clientX/clientY; patch them in explicitly. */
function wheelEvent(init: {
  deltaY: number;
  clientX?: number;
  clientY?: number;
  ctrlKey?: boolean;
}): WheelEvent {
  const event = new WheelEvent("wheel", { deltaY: init.deltaY, cancelable: true });
  Object.defineProperty(event, "clientX", { value: init.clientX ?? 0 });
  Object.defineProperty(event, "clientY", { value: init.clientY ?? 0 });
  Object.defineProperty(event, "ctrlKey", { value: init.ctrlKey ?? false });
  return event;
}

function setup(): { el: HTMLElement; camera: Camera2D; onChange: () => void; detach: () => void } {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const camera = new Camera2D();
  camera.setViewport(800, 600);
  const onChange = vi.fn();
  const detach = attachGestures(el, camera, { onChange });
  return { el, camera, onChange, detach };
}

test("drag pans the camera", () => {
  const { el, camera, onChange } = setup();
  firePointer(el, "pointerdown", { clientX: 100, clientY: 100 });
  firePointer(el, "pointermove", { clientX: 150, clientY: 120 });
  expect(camera.center.x).toBeCloseTo(-50);
  expect(camera.center.y).toBeCloseTo(20);
  expect(onChange).toHaveBeenCalled();
  firePointer(el, "pointerup", { clientX: 150, clientY: 120 });
});

test("move without prior down is ignored", () => {
  const { el, camera, onChange } = setup();
  firePointer(el, "pointermove", { clientX: 150, clientY: 120 });
  expect(camera.center).toEqual({ x: 0, y: 0 });
  expect(onChange).not.toHaveBeenCalled();
});

test("wheel zooms at the cursor", () => {
  const { el, camera, onChange } = setup();
  el.dispatchEvent(wheelEvent({ deltaY: -240, clientX: 400, clientY: 300 }));
  expect(camera.unitsPerPixel).toBeLessThan(1);
  expect(onChange).toHaveBeenCalled();
});

test("ctrl+wheel (trackpad pinch) zooms faster", () => {
  const { camera: plain, el: el1 } = setup();
  el1.dispatchEvent(wheelEvent({ deltaY: -100 }));
  const { camera: ctrl, el: el2 } = setup();
  el2.dispatchEvent(wheelEvent({ deltaY: -100, ctrlKey: true }));
  expect(ctrl.unitsPerPixel).toBeLessThan(plain.unitsPerPixel);
});

test("shift+mouse drag rotates around viewport center", () => {
  const { el, camera } = setup();
  firePointer(el, "pointerdown", { clientX: 600, clientY: 300, shiftKey: true });
  firePointer(el, "pointermove", { clientX: 600, clientY: 200, shiftKey: true });
  expect(camera.rotation).not.toBe(0);
  firePointer(el, "pointerup", { clientX: 600, clientY: 200 });
});

test("two-finger pinch zooms in", () => {
  const { el, camera } = setup();
  firePointer(el, "pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 350,
    clientY: 300,
  });
  firePointer(el, "pointerdown", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 450,
    clientY: 300,
  });
  // Spread fingers: distance 100 → 200.
  firePointer(el, "pointermove", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 550,
    clientY: 300,
  });
  expect(camera.unitsPerPixel).toBeCloseTo(0.5);
});

test("two-finger twist rotates content with the fingers", () => {
  const { el, camera } = setup();
  firePointer(el, "pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 400,
    clientY: 300,
  });
  firePointer(el, "pointerdown", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 500,
    clientY: 300,
  });
  // Rotate second finger 90° visually CCW around the first (screen y-down: up is CCW).
  firePointer(el, "pointermove", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 400,
    clientY: 200,
  });
  expect(camera.rotation).toBeCloseTo(Math.PI / 2, 1);
});

test("double tap triggers onReset", () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const camera = new Camera2D();
  camera.setViewport(800, 600);
  const onReset = vi.fn();
  attachGestures(el, camera, { onChange: () => {}, onReset });

  firePointer(el, "pointerdown", { pointerType: "touch", clientX: 100, clientY: 100 });
  firePointer(el, "pointerup", { pointerType: "touch", clientX: 100, clientY: 100 });
  firePointer(el, "pointerdown", { pointerType: "touch", clientX: 105, clientY: 103 });
  expect(onReset).toHaveBeenCalledTimes(1);
});

test("two distant taps do not trigger onReset", () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const camera = new Camera2D();
  camera.setViewport(800, 600);
  const onReset = vi.fn();
  attachGestures(el, camera, { onChange: () => {}, onReset });

  firePointer(el, "pointerdown", { pointerType: "touch", clientX: 100, clientY: 100 });
  firePointer(el, "pointerup", { pointerType: "touch", clientX: 100, clientY: 100 });
  firePointer(el, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 300 });
  expect(onReset).not.toHaveBeenCalled();
});

test("dblclick triggers onReset", () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const camera = new Camera2D();
  camera.setViewport(800, 600);
  const onReset = vi.fn();
  attachGestures(el, camera, { onChange: () => {}, onReset });
  el.dispatchEvent(new MouseEvent("dblclick", { cancelable: true }));
  expect(onReset).toHaveBeenCalledTimes(1);
});

test("detach removes all listeners", () => {
  const { el, camera, onChange, detach } = setup();
  detach();
  firePointer(el, "pointerdown", { clientX: 100, clientY: 100 });
  firePointer(el, "pointermove", { clientX: 200, clientY: 200 });
  el.dispatchEvent(wheelEvent({ deltaY: -240 }));
  expect(camera.center).toEqual({ x: 0, y: 0 });
  expect(camera.unitsPerPixel).toBe(1);
  expect(onChange).not.toHaveBeenCalled();
});

test("pointercancel clears tracked pointer", () => {
  const { el, camera } = setup();
  firePointer(el, "pointerdown", { clientX: 100, clientY: 100 });
  firePointer(el, "pointercancel", { clientX: 100, clientY: 100 });
  firePointer(el, "pointermove", { clientX: 300, clientY: 300 });
  expect(camera.center).toEqual({ x: 0, y: 0 });
});
