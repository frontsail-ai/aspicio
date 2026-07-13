// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vite-plus/test";
import { DxfViewer } from "../src/viewer.ts";

/* The real renderer needs WebGL; replace it with a spy double. */
const rendererCalls = vi.hoisted(() => ({
  setGeometry: vi.fn(),
  setLayerVisible: vi.fn(),
  setHighlight: vi.fn(),
  resize: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../src/render/renderer.ts", () => ({
  SceneRenderer: class {
    setGeometry = rendererCalls.setGeometry;
    setLayerVisible = rendererCalls.setLayerVisible;
    setHighlight = rendererCalls.setHighlight;
    resize = rendererCalls.resize;
    render = rendererCalls.render;
    dispose = rendererCalls.dispose;
  },
}));

const SAMPLE = [
  "0",
  "SECTION",
  "2",
  "TABLES",
  "0",
  "TABLE",
  "2",
  "LAYER",
  "0",
  "LAYER",
  "2",
  "WALLS",
  "70",
  "0",
  "62",
  "3",
  "0",
  "ENDTAB",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "ENTITIES",
  "0",
  "LINE",
  "8",
  "WALLS",
  "10",
  "0",
  "20",
  "0",
  "11",
  "10",
  "21",
  "5",
  "0",
  "ENDSEC",
  "0",
  "EOF",
].join("\n");

function makeViewer(): { viewer: DxfViewer; container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const viewer = new DxfViewer(container);
  return { viewer, container };
}

/** happy-dom's WheelEvent drops clientX/clientY; patch them in explicitly. */
function wheelEvent(init: { deltaY: number; clientX?: number; clientY?: number }): WheelEvent {
  const event = new WheelEvent("wheel", { deltaY: init.deltaY, cancelable: true });
  Object.defineProperty(event, "clientX", { value: init.clientX ?? 0 });
  Object.defineProperty(event, "clientY", { value: init.clientY ?? 0 });
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("constructor mounts a canvas into the container", () => {
  const { container } = makeViewer();
  expect(container.querySelector("canvas")).not.toBeNull();
});

test("load(string) parses, tessellates, and emits loaded", async () => {
  const { viewer } = makeViewer();
  const loaded = vi.fn();
  viewer.on("loaded", loaded);

  await viewer.load(SAMPLE);

  expect(viewer.document).not.toBeNull();
  expect(loaded).toHaveBeenCalledTimes(1);
  expect(rendererCalls.setGeometry).toHaveBeenCalledTimes(1);
  expect(viewer.stats.entityCount).toBe(1);
  expect(viewer.stats.segmentCount).toBe(1);
  expect(viewer.getLayers().map((l) => l.name)).toEqual(["WALLS"]);
});

test("load(Blob) and load(ArrayBuffer) decode to the same document", async () => {
  const { viewer: v1 } = makeViewer();
  await v1.load(new Blob([SAMPLE]));
  expect(v1.stats.entityCount).toBe(1);

  const { viewer: v2 } = makeViewer();
  await v2.load(new TextEncoder().encode(SAMPLE).buffer as ArrayBuffer);
  expect(v2.stats.entityCount).toBe(1);
});

test("loadUrl fetches and loads", async () => {
  const { viewer } = makeViewer();
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(SAMPLE, { status: 200 }));
  await viewer.loadUrl("/x.dxf");
  expect(fetchMock).toHaveBeenCalledWith("/x.dxf");
  expect(viewer.stats.entityCount).toBe(1);
  fetchMock.mockRestore();
});

test("loadUrl rejects on HTTP error", async () => {
  const { viewer } = makeViewer();
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("nope", { status: 404 }));
  await expect(viewer.loadUrl("/missing.dxf")).rejects.toThrow("404");
  fetchMock.mockRestore();
});

test("setLayerVisible updates document and renderer", async () => {
  const { viewer } = makeViewer();
  await viewer.load(SAMPLE);
  viewer.setLayerVisible("WALLS", false);
  expect(viewer.getLayers()[0].visible).toBe(false);
  expect(rendererCalls.setLayerVisible).toHaveBeenCalledWith("WALLS", false);
});

test("stats are empty before any load", () => {
  const { viewer } = makeViewer();
  expect(viewer.stats).toEqual({ entityCount: 0, segmentCount: 0, unsupported: {} });
  expect(viewer.getLayers()).toEqual([]);
});

test("fitView without a document is a no-op that still renders", () => {
  const { viewer } = makeViewer();
  expect(() => viewer.fitView()).not.toThrow();
});

test("setView restores a pose read from view (round-trip)", async () => {
  const { viewer } = makeViewer();
  await viewer.load(SAMPLE);
  const pose = { center: { x: 12.5, y: -7.25 }, unitsPerPixel: 0.42, rotation: 0.6 };
  viewer.setView(pose);
  expect(viewer.view).toEqual(pose);
  // The returned snapshot is a copy, not a live alias into the camera.
  expect(viewer.view.center).not.toBe(pose.center);
});

test("setView rejects a non-positive unitsPerPixel", async () => {
  const { viewer } = makeViewer();
  await viewer.load(SAMPLE);
  const before = viewer.view;
  viewer.setView({ center: { x: 5, y: 5 }, unitsPerPixel: 0, rotation: 1 });
  expect(viewer.view).toEqual(before);
});

test("setView animate path eases to the target pose", async () => {
  const { viewer } = makeViewer();
  await viewer.load(SAMPLE);
  viewer.setView(
    { center: { x: 3, y: 4 }, unitsPerPixel: 0.9, rotation: 0.2 },
    {
      animate: true,
      durationMs: 60,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(viewer.view.unitsPerPixel).toBeCloseTo(0.9, 5);
  expect(viewer.view.center.x).toBeCloseTo(3, 5);
  expect(viewer.view.rotation).toBeCloseTo(0.2, 5);
});

test("off removes a listener", async () => {
  const { viewer } = makeViewer();
  const listener = vi.fn();
  viewer.on("loaded", listener);
  viewer.off("loaded", listener);
  await viewer.load(SAMPLE);
  expect(listener).not.toHaveBeenCalled();
});

test("render event fires after load (coalesced via rAF)", async () => {
  const { viewer } = makeViewer();
  const rendered = new Promise<void>((resolve) => viewer.on("render", resolve));
  await viewer.load(SAMPLE);
  await rendered;
  expect(rendererCalls.render).toHaveBeenCalled();
});

test("canvas gestures drive the camera through the facade", async () => {
  const { viewer, container } = makeViewer();
  await viewer.load(SAMPLE);
  const canvas = container.querySelector("canvas");
  if (!canvas) throw new Error("no canvas");

  // Wheel zoom flows through onChange → requestRender.
  canvas.dispatchEvent(wheelEvent({ deltaY: -240 }));
  // Double click flows through onReset → fitView.
  canvas.dispatchEvent(new MouseEvent("dblclick", { cancelable: true }));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(rendererCalls.render).toHaveBeenCalled();
});

test("setLayerHighlight forwards to the renderer and dedupes", async () => {
  const { viewer } = makeViewer();
  await viewer.load(SAMPLE);
  viewer.setLayerHighlight("WALLS");
  viewer.setLayerHighlight("WALLS"); // no-op, same layer
  expect(rendererCalls.setHighlight).toHaveBeenCalledTimes(1);
  expect(rendererCalls.setHighlight).toHaveBeenCalledWith("WALLS");
  viewer.setLayerHighlight(null);
  expect(rendererCalls.setHighlight).toHaveBeenLastCalledWith(null);
});

test("highlighting a hidden layer is treated as clearing", async () => {
  const { viewer } = makeViewer();
  await viewer.load(SAMPLE);
  viewer.setLayerVisible("WALLS", false);
  viewer.setLayerHighlight("WALLS");
  expect(rendererCalls.setHighlight).not.toHaveBeenCalledWith("WALLS");
});

test("hiding the highlighted layer clears the highlight", async () => {
  const { viewer } = makeViewer();
  await viewer.load(SAMPLE);
  viewer.setLayerHighlight("WALLS");
  viewer.setLayerVisible("WALLS", false);
  expect(rendererCalls.setHighlight).toHaveBeenLastCalledWith(null);
});

test("pickLayer hit-tests visible geometry through the camera", async () => {
  const { viewer } = makeViewer();
  await viewer.load(SAMPLE);
  // happy-dom containers have zero size → 1×1 viewport; the fitted view puts
  // the line's midpoint at the (single) center pixel.
  expect(viewer.pickLayer(0.5, 0.5)).toBe("WALLS");
  // A point off the line with a tiny tolerance misses.
  expect(viewer.pickLayer(0.9, 0.5, 0.0001)).toBeNull();
  viewer.setLayerVisible("WALLS", false);
  expect(viewer.pickLayer(0.5, 0.5)).toBeNull();
});

test("pickLayer before any load returns null", () => {
  const { viewer } = makeViewer();
  expect(viewer.pickLayer(0, 0)).toBeNull();
});

test("animated fitView eases the camera to the fitted pose", async () => {
  const { viewer, container } = makeViewer();
  await viewer.load(SAMPLE);
  const fitted = viewer.view;

  // Disturb the camera via a wheel zoom.
  const canvas = container.querySelector("canvas");
  canvas?.dispatchEvent(wheelEvent({ deltaY: -480 }));
  expect(viewer.view.unitsPerPixel).toBeLessThan(fitted.unitsPerPixel);

  viewer.fitView({ animate: true, durationMs: 60 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(viewer.view.unitsPerPixel).toBeCloseTo(fitted.unitsPerPixel, 6);
  expect(viewer.view.center.x).toBeCloseTo(fitted.center.x, 6);
  expect(viewer.view.rotation).toBe(0);
});

test("a user gesture cancels a running fit animation", async () => {
  const { viewer, container } = makeViewer();
  await viewer.load(SAMPLE);
  const canvas = container.querySelector("canvas");
  canvas?.dispatchEvent(wheelEvent({ deltaY: -480 }));

  viewer.fitView({ animate: true, durationMs: 100 });
  // Interrupt immediately with another gesture.
  canvas?.dispatchEvent(wheelEvent({ deltaY: -120 }));
  const interrupted = viewer.view.unitsPerPixel;
  await new Promise((resolve) => setTimeout(resolve, 150));
  // The animation must not have kept running after the gesture.
  expect(viewer.view.unitsPerPixel).toBe(interrupted);
});

test("effectiveColors reflect entity overrides, dominant first", async () => {
  const { viewer } = makeViewer();
  // Layer table says green (ACI 3), but two entities override to red (62=1)
  // and one stays ByLayer — dominant effective color must be red.
  const dxf = [
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "TABLE",
    "2",
    "LAYER",
    "0",
    "LAYER",
    "2",
    "W",
    "70",
    "0",
    "62",
    "3",
    "0",
    "ENDTAB",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "0",
    "LINE",
    "8",
    "W",
    "62",
    "1",
    "10",
    "0",
    "20",
    "0",
    "11",
    "1",
    "21",
    "0",
    "0",
    "LINE",
    "8",
    "W",
    "62",
    "1",
    "10",
    "0",
    "20",
    "1",
    "11",
    "1",
    "21",
    "1",
    "0",
    "LINE",
    "8",
    "W",
    "10",
    "0",
    "20",
    "2",
    "11",
    "1",
    "21",
    "2",
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ].join("\n");
  await viewer.load(dxf);

  const layer = viewer.getLayers()[0];
  expect(layer.color).toBe(0x00ff00); // table color unchanged
  expect(layer.effectiveColors).toEqual([0xff0000, 0x00ff00]); // dominant first
});

test("layers without geometry fall back to the table color", async () => {
  const { viewer } = makeViewer();
  const dxf = [
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "TABLE",
    "2",
    "LAYER",
    "0",
    "LAYER",
    "2",
    "EMPTY",
    "70",
    "0",
    "62",
    "5",
    "0",
    "ENDTAB",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "0",
    "MTEXT",
    "8",
    "EMPTY",
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ].join("\n");
  await viewer.load(dxf);
  expect(viewer.getLayers()[0].effectiveColors).toEqual([0x0000ff]);
});

test("zoomBy scales at the viewport center, immediate and animated", async () => {
  const { viewer } = makeViewer();
  await viewer.load(SAMPLE);
  const before = viewer.view;

  viewer.zoomBy(2);
  expect(viewer.view.unitsPerPixel).toBeCloseTo(before.unitsPerPixel / 2);
  expect(viewer.view.center).toEqual(before.center);

  viewer.zoomBy(0.5, { animate: true, durationMs: 50 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(viewer.view.unitsPerPixel).toBeCloseTo(before.unitsPerPixel, 6);
});

test("resetRotation returns to 0 keeping center and zoom", async () => {
  const { viewer, container } = makeViewer();
  await viewer.load(SAMPLE);
  const canvas = container.querySelector("canvas");
  // Rotate via shift+drag gesture events.
  canvas?.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 100,
      clientY: 0,
      shiftKey: true,
    }),
  );
  canvas?.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 100,
      clientY: 80,
      shiftKey: true,
    }),
  );
  canvas?.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
  expect(viewer.view.rotation).not.toBe(0);
  const zoom = viewer.view.unitsPerPixel;

  viewer.resetRotation({ animate: true, durationMs: 50 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(viewer.view.rotation).toBe(0);
  expect(viewer.view.unitsPerPixel).toBeCloseTo(zoom, 6);
});

test("dispose removes the canvas and detaches everything", () => {
  const { viewer, container } = makeViewer();
  viewer.dispose();
  expect(container.querySelector("canvas")).toBeNull();
  expect(rendererCalls.dispose).toHaveBeenCalledTimes(1);
});
