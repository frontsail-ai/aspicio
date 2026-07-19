// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode, createRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { DxfViewer } from "@aspicio/core";
import { DxfEmbed } from "../src/DxfEmbed.tsx";
import { DxfLayerPanel } from "../src/DxfLayerPanel.tsx";
import { DxfPreview } from "../src/DxfPreview.tsx";

/* ---------- @aspicio/core double ---------- */

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
    pickLayer = vi.fn((_x: number, _y: number) => "CUT" as string | null);
    fitView = vi.fn();
    zoomBy = vi.fn();
    resetRotation = vi.fn();
    toSVG = vi.fn((_opts?: unknown) => "<svg></svg>");
    toPNG = vi.fn((_opts?: unknown) => "data:image/png;base64,AAAA");
    dispose = vi.fn(() => {
      this.disposed = true;
    });

    options: Record<string, unknown> | undefined;
    constructor(container: HTMLElement, options?: Record<string, unknown>) {
      this.container = container;
      this.options = options;
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

vi.mock("@aspicio/core", () => ({
  DxfViewer: mock.MockViewer,
  // A faithful attachShortcuts so the shortcuts effect can be exercised.
  attachShortcuts: (target: EventTarget, viewer: MockShortcutViewer) => {
    const onKey = (ev: Event): void => {
      const e = ev as KeyboardEvent;
      if (e.key === "f" || e.key === "F") viewer.fitView();
      else if (e.key === "a" || e.key === "A")
        for (const l of viewer.getLayers()) viewer.setLayerVisible(l.name, true);
    };
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  },
}));

interface MockShortcutViewer {
  fitView: () => void;
  getLayers: () => { name: string }[];
  setLayerVisible: (name: string, visible: boolean) => void;
}

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

test("shows the download control by default and exports on click", async () => {
  const { container } = render(<DxfPreview />);
  await flush();
  const btn = container.querySelector('[aria-label="Download"]') as HTMLElement | null;
  expect(btn).not.toBeNull();
  fireEvent.click(btn!); // open the menu
  const png = [...container.querySelectorAll("button")].find((b) => b.textContent === "PNG");
  fireEvent.click(png!);
  expect(lastViewer().toPNG).toHaveBeenCalled();
});

test("showDownload={false} hides the download control", async () => {
  const { container } = render(<DxfPreview showDownload={false} />);
  await flush();
  expect(container.querySelector('[aria-label="Download"]')).toBeNull();
});

test("shortcuts prop enables keyboard camera + show-all on the container", async () => {
  const { container } = render(<DxfPreview shortcuts />);
  await flush();
  const el = container.querySelector("div") as HTMLElement;
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  expect(lastViewer().fitView).toHaveBeenCalled();
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  expect(lastViewer().setLayerVisible).toHaveBeenCalled(); // show-all unhides layers
});

test("shortcuts default off — no keyboard handling", async () => {
  const { container } = render(<DxfPreview />);
  await flush();
  const el = container.querySelector("div") as HTMLElement;
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  expect(lastViewer().fitView).not.toHaveBeenCalled();
});

/* ---------- DxfEmbed ---------- */

test("DxfEmbed forwards showDownload to hide the download control", async () => {
  const { container } = render(<DxfEmbed showDownload={false} />);
  await flush();
  expect(container.querySelector('[aria-label="Download"]')).toBeNull();
});

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

test("DxfEmbed is themed like the demo app by default", async () => {
  const { container } = render(<DxfEmbed src="dxf-data" />);
  await flush();
  const root = container.firstElementChild as HTMLElement;
  expect(root.style.background).toContain("#0f1115");
  expect(root.style.overflow).toBe("hidden");
  // The themed panel background lives on the panel wrapper (first child).
  const panel = root.firstElementChild as HTMLElement;
  expect(panel.style.background).toContain("#191c22");
  // Themed embeds default to a transparent canvas so the grid shows through.
  expect(lastViewer().options).toMatchObject({ background: null });
});

test("DxfEmbed theme=none inherits the host page", async () => {
  const { container, getByRole } = render(<DxfEmbed src="dxf-data" theme="none" />);
  await flush();
  const root = container.firstElementChild as HTMLElement;
  expect(root.style.background).toBe("");
  expect((getByRole("list") as HTMLElement).style.background).toBe("");
  expect(lastViewer().options?.background).toBeUndefined();
});

test("DxfEmbed keeps an explicit background over the themed default", async () => {
  render(<DxfEmbed src="dxf-data" options={{ background: 0x112233 }} />);
  await flush();
  expect(lastViewer().options).toMatchObject({ background: 0x112233 });
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

test("themed panel shows a header with the layer count and a hints footer", () => {
  const { getByText } = renderPanel();
  expect(getByText("LAYERS")).toBeTruthy();
  expect(getByText("2")).toBeTruthy(); // count badge (CUT + MARK)
  expect(getByText("solo layer")).toBeTruthy(); // a gesture hint
});

test("hints footer can be disabled", () => {
  const viewer = new mock.MockViewer(document.createElement("div"));
  const { queryByText } = render(
    <DxfLayerPanel viewer={viewer as unknown as DxfViewer} hints={false} />,
  );
  expect(queryByText("solo layer")).toBeNull();
});

test("double-clicking a row solos it, then EXIT restores all layers", () => {
  const { viewer, getByText, queryByText } = renderPanel();
  fireEvent.doubleClick(getByText("CUT").closest("li")!);
  // Solo hides every other layer and shows the banner (EXIT is unique to it).
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("MARK", false);
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("CUT", true);
  expect(getByText("EXIT")).toBeTruthy();

  viewer.setLayerVisible.mockClear();
  fireEvent.click(getByText("EXIT"));
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("MARK", true);
  expect(queryByText("EXIT")).toBeNull();
});

test("reverseHighlightLayer marks the matching row", () => {
  const viewer = new mock.MockViewer(document.createElement("div"));
  const { getByText } = render(
    <DxfLayerPanel viewer={viewer as unknown as DxfViewer} reverseHighlightLayer="CUT" />,
  );
  const cutRow = getByText("CUT").closest("li") as HTMLElement;
  const markRow = getByText("MARK").closest("li") as HTMLElement;
  // The reverse-highlighted row gets the accent border; the other doesn't.
  expect(cutRow.style.borderColor).toContain("#4c8dff");
  expect(markRow.style.borderColor).toContain("transparent");
});

/* ---------- DxfPreview canvas hover-picking ---------- */

test("onHoverLayer reports the picked layer and highlights it", async () => {
  const onHoverLayer = vi.fn();
  const { container } = render(<DxfPreview src="dxf-data" onHoverLayer={onHoverLayer} />);
  await flush();
  const host = container.firstElementChild as HTMLElement;
  host.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;

  host.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerType: "mouse",
      clientX: 5,
      clientY: 5,
    }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));

  expect(lastViewer().pickLayer).toHaveBeenCalled();
  expect(onHoverLayer).toHaveBeenCalledWith("CUT");
  expect(lastViewer().setLayerHighlight).toHaveBeenCalledWith("CUT");
});

test("DxfEmbed wires canvas hover to the panel's reverse-highlight", async () => {
  const { container } = render(<DxfEmbed src="dxf-data" />);
  await flush();
  // Panel is on the left, so the preview is the embed root's last child.
  const host = container.firstElementChild!.lastElementChild as HTMLElement;
  host.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  await act(async () => {
    host.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
        clientX: 5,
        clientY: 5,
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

  const cutRow = container.querySelector("li") as HTMLElement; // first row = CUT
  expect(cutRow.style.borderColor).toContain("#4c8dff");
});
