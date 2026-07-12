// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode, createRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { DxfViewer } from "@observo/core";
import { DxfEmbed } from "../src/DxfEmbed.tsx";
import { DxfLayerPanel } from "../src/DxfLayerPanel.tsx";
import { DxfPreview } from "../src/DxfPreview.tsx";

/* ---------- @observo/core double ---------- */

const mock = vi.hoisted(() => {
  class MockViewer {
    container: HTMLElement;
    disposed = false;
    layers = [
      {
        name: "CUT",
        color: 0xffffff,
        effectiveColors: [0xff0000],
        visible: true,
        frozen: false,
        entityCount: 3,
      },
      { name: "MARK", color: 0x00ff00, visible: true, frozen: false, entityCount: 1 },
    ];
    listeners = new Map<string, Set<() => void>>();
    load = vi.fn((_src: unknown) => Promise.resolve());
    loadUrl = vi.fn((_url: string) => Promise.resolve());
    setLayerVisible = vi.fn((name: string, visible: boolean) => {
      const layer = this.layers.find((l) => l.name === name);
      if (layer) layer.visible = visible;
    });
    setLayerHighlight = vi.fn();
    dispose = vi.fn(() => {
      this.disposed = true;
    });

    constructor(container: HTMLElement) {
      this.container = container;
      instances.push(this);
    }
    getLayers() {
      return this.layers;
    }
    get stats() {
      return { entityCount: 4, segmentCount: 9, unsupported: {} };
    }
    on(event: string, listener: () => void): void {
      let set = this.listeners.get(event);
      if (!set) this.listeners.set(event, (set = new Set()));
      set.add(listener);
    }
    off(event: string, listener: () => void): void {
      this.listeners.get(event)?.delete(listener);
    }
    emit(event: string): void {
      for (const listener of this.listeners.get(event) ?? []) listener();
    }
  }
  const instances: MockViewer[] = [];
  return { MockViewer, instances };
});

vi.mock("@observo/core", () => ({ DxfViewer: mock.MockViewer }));

const flush = () => act(() => Promise.resolve());
const lastViewer = () => mock.instances[mock.instances.length - 1];

beforeEach(() => {
  mock.instances.length = 0;
  vi.clearAllMocks();
});
afterEach(cleanup);

/* ---------- DxfPreview ---------- */

test("mounts a viewer into the container and disposes on unmount", async () => {
  const { container, unmount } = render(<DxfPreview className="preview" />);
  await flush();
  expect(mock.instances).toHaveLength(1);
  expect(lastViewer().container).toBe(container.querySelector(".preview"));
  unmount();
  expect(lastViewer().disposed).toBe(true);
});

test("survives StrictMode double-mounting", async () => {
  const { unmount } = render(
    <StrictMode>
      <DxfPreview />
    </StrictMode>,
  );
  await flush();
  // Mount, cleanup, mount again: the earlier instance is disposed, one lives.
  const alive = mock.instances.filter((v) => !v.disposed);
  expect(alive).toHaveLength(1);
  unmount();
  expect(mock.instances.every((v) => v.disposed)).toBe(true);
});

test("loads src data and reports layers and stats", async () => {
  const onLoaded = vi.fn();
  render(<DxfPreview src="dxf-data" onLoaded={onLoaded} />);
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
  expect(onLoaded).toHaveBeenCalledWith({
    layers: lastViewer().layers,
    stats: { entityCount: 4, segmentCount: 9, unsupported: {} },
  });
});

test("srcUrl uses loadUrl", async () => {
  render(<DxfPreview srcUrl="/plan.dxf" />);
  await flush();
  expect(lastViewer().loadUrl).toHaveBeenCalledWith("/plan.dxf");
  expect(lastViewer().load).not.toHaveBeenCalled();
});

test("a newer src supersedes a slow in-flight load", async () => {
  const onLoaded = vi.fn();
  let finishFirst: () => void = () => {};
  const { rerender } = render(<DxfPreview src="first" onLoaded={onLoaded} />);
  await flush();
  lastViewer().load.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finishFirst = resolve)),
  );

  rerender(<DxfPreview src="second" onLoaded={onLoaded} />);
  rerender(<DxfPreview src="third" onLoaded={onLoaded} />);
  finishFirst();
  await flush();
  // "second" resolved after "third" started: only the latest load reports.
  const calls = lastViewer().load.mock.calls.map(([arg]) => arg);
  expect(calls).toEqual(["first", "second", "third"]);
  expect(onLoaded).toHaveBeenCalledTimes(2); // first + third, not second
});

test("onError fires for failed loads", async () => {
  const onError = vi.fn();
  render(<DxfPreview src="bad" onError={onError} />);
  await flush();
  lastViewer().load.mockRejectedValueOnce(new Error("nope"));
  // Trigger a re-load by changing src via rerender within same viewer.
  await flush();
  // First load already succeeded; render a failing one:
  const { rerender } = render(<DxfPreview src="ok" onError={onError} />);
  await flush();
  lastViewer().load.mockRejectedValueOnce(new Error("boom"));
  rerender(<DxfPreview src="broken" onError={onError} />);
  await flush();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
});

test("exposes the viewer via ref and onViewer", async () => {
  const ref = createRef<DxfViewer>();
  const onViewer = vi.fn();
  const { unmount } = render(<DxfPreview ref={ref} onViewer={onViewer} />);
  await flush();
  expect(ref.current).toBe(lastViewer() as unknown as DxfViewer);
  expect(onViewer).toHaveBeenCalledWith(lastViewer());
  unmount();
  expect(onViewer).toHaveBeenLastCalledWith(null);
});

/* ---------- DxfEmbed ---------- */

test("DxfEmbed renders panel and preview together and loads src", async () => {
  const { container, getByText } = render(<DxfEmbed src="dxf-data" style={{ height: 400 }} />);
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
  // Panel lists the loaded layers; preview container exists beside it.
  expect(getByText("CUT")).toBeTruthy();
  expect(getByText("MARK")).toBeTruthy();
  expect(container.querySelectorAll("ul")).toHaveLength(1);
  expect(lastViewer().container).toBeTruthy();
});

test("DxfEmbed panel interactions drive the viewer", async () => {
  const { getByLabelText } = render(<DxfEmbed src="dxf-data" />);
  await flush();
  fireEvent.click(getByLabelText("CUT"));
  expect(lastViewer().setLayerVisible).toHaveBeenCalledWith("CUT", false);
});

test("DxfEmbed with panel=none renders no layer list", async () => {
  const { container } = render(<DxfEmbed src="dxf-data" panel="none" />);
  await flush();
  expect(container.querySelector("ul")).toBeNull();
});

test("DxfEmbed exposes the viewer via ref", async () => {
  const ref = createRef<DxfViewer>();
  render(<DxfEmbed src="dxf-data" ref={ref} />);
  await flush();
  expect(ref.current).toBe(lastViewer() as unknown as DxfViewer);
});

/* ---------- DxfLayerPanel ---------- */

function renderPanel() {
  const viewer = new mock.MockViewer(document.createElement("div"));
  const utils = render(<DxfLayerPanel viewer={viewer as unknown as DxfViewer} />);
  return { viewer, ...utils };
}

test("renders one row per layer with effective-color swatches", () => {
  const { getByText, container } = renderPanel();
  expect(getByText("CUT")).toBeTruthy();
  expect(getByText("MARK")).toBeTruthy();
  const swatches = container.querySelectorAll("li span[aria-hidden]");
  // CUT prefers effectiveColors[0] (red); MARK falls back to table color.
  expect((swatches[0] as HTMLElement).style.background).toContain("#ff0000");
  expect((swatches[1] as HTMLElement).style.background).toContain("#00ff00");
});

test("checkbox toggles layer visibility", () => {
  const { viewer, getByLabelText } = renderPanel();
  fireEvent.click(getByLabelText("CUT"));
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("CUT", false);
});

test("row hover highlights the layer and clears on leave", () => {
  const { viewer, getByText } = renderPanel();
  const row = getByText("CUT").closest("li");
  if (!row) throw new Error("row not found");
  fireEvent.mouseEnter(row);
  expect(viewer.setLayerHighlight).toHaveBeenCalledWith("CUT");
  fireEvent.mouseLeave(row);
  expect(viewer.setLayerHighlight).toHaveBeenCalledWith(null);
});

test("re-syncs rows when the viewer loads a new document", () => {
  const { viewer, queryByText } = renderPanel();
  viewer.layers = [{ name: "NEW", color: 0x0000ff, visible: true, frozen: false, entityCount: 7 }];
  act(() => viewer.emit("loaded"));
  expect(queryByText("NEW")).toBeTruthy();
  expect(queryByText("CUT")).toBeNull();
});
