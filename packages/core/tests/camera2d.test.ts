import { expect, test } from "vite-plus/test";
import { Camera2D } from "../src/camera/camera2d.ts";

function makeCamera(): Camera2D {
  const camera = new Camera2D();
  camera.setViewport(800, 600);
  return camera;
}

test("setViewport clamps to at least 1px", () => {
  const camera = new Camera2D();
  camera.setViewport(0, -5);
  expect(camera.viewportWidth).toBe(1);
  expect(camera.viewportHeight).toBe(1);
});

test("fit centers bounds and picks the limiting axis", () => {
  const camera = makeCamera();
  camera.rotation = 1; // fit must reset it
  camera.fit({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
  expect(camera.center).toEqual({ x: 50, y: 25 });
  expect(camera.rotation).toBe(0);
  // Width is limiting: 100 / (800 * 0.9)
  expect(camera.unitsPerPixel).toBeCloseTo(100 / 720);
});

test("fit handles degenerate (zero-size) bounds", () => {
  const camera = makeCamera();
  camera.fit({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
  expect(camera.center).toEqual({ x: 5, y: 5 });
  expect(camera.unitsPerPixel).toBeGreaterThan(0);
  expect(Number.isFinite(camera.unitsPerPixel)).toBe(true);
});

test("screenToWorld maps viewport center to camera center", () => {
  const camera = makeCamera();
  camera.center = { x: 10, y: 20 };
  camera.unitsPerPixel = 2;
  const world = camera.screenToWorld(400, 300);
  expect(world.x).toBeCloseTo(10);
  expect(world.y).toBeCloseTo(20);
});

test("screenToWorld respects zoom and y-down convention", () => {
  const camera = makeCamera();
  camera.unitsPerPixel = 2;
  // 100px right, 50px down from center.
  const world = camera.screenToWorld(500, 350);
  expect(world.x).toBeCloseTo(200);
  expect(world.y).toBeCloseTo(-100);
});

test("screenToWorld with 90° rotation maps screen-right to world -y", () => {
  const camera = makeCamera();
  camera.rotation = Math.PI / 2;
  const world = camera.screenToWorld(500, 300); // 100px right of center
  expect(world.x).toBeCloseTo(0);
  expect(world.y).toBeCloseTo(-100);
});

test("panPixels makes content follow the pointer", () => {
  const camera = makeCamera();
  camera.unitsPerPixel = 1;
  camera.panPixels(100, 0); // drag right → view center moves left in world
  expect(camera.center.x).toBeCloseTo(-100);
  expect(camera.center.y).toBeCloseTo(0);
  camera.panPixels(0, 50); // drag down → center moves up in world (y-down screen)
  expect(camera.center.y).toBeCloseTo(50);
});

test("panPixels under rotation moves along rotated axes", () => {
  const camera = makeCamera();
  camera.rotation = Math.PI / 2;
  camera.panPixels(100, 0);
  // Screen-right is world -y at 90° rotation.
  expect(camera.center.x).toBeCloseTo(0);
  expect(camera.center.y).toBeCloseTo(100);
});

test("zoomAt scales unitsPerPixel and anchors the point under the cursor", () => {
  const camera = makeCamera();
  camera.unitsPerPixel = 1;
  const anchorBefore = camera.screenToWorld(200, 150);
  camera.zoomAt(200, 150, 2);
  expect(camera.unitsPerPixel).toBeCloseTo(0.5);
  const anchorAfter = camera.screenToWorld(200, 150);
  expect(anchorAfter.x).toBeCloseTo(anchorBefore.x);
  expect(anchorAfter.y).toBeCloseTo(anchorBefore.y);
});

test("rotateAround anchors the point under the cursor", () => {
  const camera = makeCamera();
  camera.unitsPerPixel = 1.5;
  const anchorBefore = camera.screenToWorld(600, 100);
  camera.rotateAround(600, 100, 0.7);
  expect(camera.rotation).toBeCloseTo(0.7);
  const anchorAfter = camera.screenToWorld(600, 100);
  expect(anchorAfter.x).toBeCloseTo(anchorBefore.x);
  expect(anchorAfter.y).toBeCloseTo(anchorBefore.y);
});

test("zoom and rotate compose without drift", () => {
  const camera = makeCamera();
  camera.fit({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  const anchorBefore = camera.screenToWorld(300, 200);
  camera.zoomAt(300, 200, 1.5);
  camera.rotateAround(300, 200, -0.4);
  camera.zoomAt(300, 200, 0.5);
  const anchorAfter = camera.screenToWorld(300, 200);
  expect(anchorAfter.x).toBeCloseTo(anchorBefore.x);
  expect(anchorAfter.y).toBeCloseTo(anchorBefore.y);
});
