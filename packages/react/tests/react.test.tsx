// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode, createRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { DrawingViewer } from "@aspicio/core";
import { AspicioEmbed } from "../src/AspicioEmbed.tsx";
import "../src/formats/dxf.ts";
import { AspicioLayerPanel } from "../src/AspicioLayerPanel.tsx";
import { AspicioPreview } from "../src/AspicioPreview.tsx";

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
  DrawingViewer: mock.MockViewer,
  // A faithful attachShortcuts so the shortcuts wiring can be exercised.
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

/* ---------- helpers ---------- */

// The components render web components; settle both React and Lit cycles.
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const lastViewer = () => mock.instances[mock.instances.length - 1];

/** Shadow root of the first matching element — the components' DOM is shadow DOM. */
function shadowOf(container: HTMLElement, selector: string): ShadowRoot {
  const el = container.querySelector(selector);
  if (!el?.shadowRoot) throw new Error(`no shadow root for ${selector}`);
  return el.shadowRoot;
}

const panelShadow = (container: HTMLElement): ShadowRoot => {
  const embed = shadowOf(container, "aspicio-embed");
  const panel = embed.querySelector("aspicio-layer-panel");
  if (!panel?.shadowRoot) throw new Error("no panel in embed");
  return panel.shadowRoot;
};
const embedPreviewShadow = (container: HTMLElement): ShadowRoot => {
  const embed = shadowOf(container, "aspicio-embed");
  const preview = embed.querySelector("aspicio-preview");
  if (!preview?.shadowRoot) throw new Error("no preview in embed");
  return preview.shadowRoot;
};
const rowByName = (root: ShadowRoot, name: string): HTMLElement => {
  const row = [...root.querySelectorAll<HTMLElement>(".row")].find(
    (r) => r.querySelector(".name")?.textContent?.trim() === name,
  );
  if (!row) throw new Error(`row ${name} not found`);
  return row;
};

beforeEach(() => {
  mock.instances.length = 0;
  vi.clearAllMocks();
});
afterEach(cleanup);

/* ---------- AspicioPreview ---------- */

test("mounts a viewer into the element and disposes on unmount", async () => {
  const { container, unmount } = render(<AspicioPreview className="preview" />);
  await flush();
  expect(mock.instances).toHaveLength(1);
  const shadow = shadowOf(container, "aspicio-preview.preview");
  expect(lastViewer().container).toBe(shadow.querySelector(".canvas-host"));
  unmount();
  expect(lastViewer().disposed).toBe(true);
});

test("survives StrictMode double-mounting", async () => {
  const { unmount } = render(
    <StrictMode>
      <AspicioPreview />
    </StrictMode>,
  );
  await flush();
  const alive = mock.instances.filter((v) => !v.disposed);
  expect(alive).toHaveLength(1);
  unmount();
  expect(mock.instances.every((v) => v.disposed)).toBe(true);
});

test("loads src data and reports layers and stats", async () => {
  const onLoaded = vi.fn();
  render(<AspicioPreview src="dxf-data" onLoaded={onLoaded} />);
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
  expect(lastViewer().load).toHaveBeenCalledTimes(1);
  expect(onLoaded).toHaveBeenCalledWith({
    layers: lastViewer().layers,
    stats: { entityCount: 4, segmentCount: 9, unsupported: {} },
  });
});

test("srcUrl uses loadUrl", async () => {
  render(<AspicioPreview srcUrl="/plan.dxf" />);
  await flush();
  expect(lastViewer().loadUrl).toHaveBeenCalledWith("/plan.dxf");
  expect(lastViewer().load).not.toHaveBeenCalled();
});

test("a newer src supersedes a slow in-flight load", async () => {
  const onLoaded = vi.fn();
  let finishSecond: () => void = () => {};
  const { rerender } = render(<AspicioPreview src="first" onLoaded={onLoaded} />);
  await flush();
  lastViewer().load.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finishSecond = resolve)),
  );

  rerender(<AspicioPreview src="second" onLoaded={onLoaded} />);
  await flush();
  rerender(<AspicioPreview src="third" onLoaded={onLoaded} />);
  await flush();
  finishSecond();
  await flush();
  // "second" resolved after "third" started: only the latest load reports.
  const calls = lastViewer().load.mock.calls.map(([arg]) => arg);
  expect(calls).toEqual(["first", "second", "third"]);
  expect(onLoaded).toHaveBeenCalledTimes(2); // first + third, not second
});

test("switching from srcUrl to src loads the data — last-set source wins", async () => {
  const { rerender } = render(<AspicioPreview srcUrl="/plan.dxf" />);
  await flush();
  expect(lastViewer().loadUrl).toHaveBeenCalledWith("/plan.dxf");
  const loadUrlCalls = lastViewer().loadUrl.mock.calls.length;

  // React re-assigns both props every render; only the genuine change counts.
  rerender(<AspicioPreview srcUrl="/plan.dxf" src="dxf-data" />);
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");

  rerender(<AspicioPreview srcUrl="/plan.dxf" src="dxf-data" />); // no changes
  await flush();
  expect(lastViewer().load).toHaveBeenCalledTimes(1);
  expect(lastViewer().loadUrl.mock.calls.length).toBe(loadUrlCalls);
});

test("onError fires for failed loads", async () => {
  const onError = vi.fn();
  const { rerender } = render(<AspicioPreview src="ok" onError={onError} />);
  await flush();
  lastViewer().load.mockRejectedValueOnce(new Error("boom"));
  rerender(<AspicioPreview src="broken" onError={onError} />);
  await flush();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
});

test("exposes the viewer via ref and onViewer", async () => {
  const ref = createRef<DrawingViewer>();
  const onViewer = vi.fn();
  const { unmount } = render(<AspicioPreview ref={ref} onViewer={onViewer} />);
  await flush();
  expect(ref.current).toBe(lastViewer() as unknown as DrawingViewer);
  expect(onViewer).toHaveBeenCalledWith(lastViewer());
  unmount();
  expect(onViewer).toHaveBeenLastCalledWith(null);
});

test("shows the download control by default and exports on click", async () => {
  const { container } = render(<AspicioPreview />);
  await flush();
  const shadow = shadowOf(container, "aspicio-preview");
  const btn = shadow.querySelector<HTMLElement>('[aria-label="Download"]');
  expect(btn).not.toBeNull();
  fireEvent.click(btn!); // open the menu
  await flush();
  const png = [...shadow.querySelectorAll("button")].find((b) => b.textContent?.trim() === "PNG");
  fireEvent.click(png!);
  expect(lastViewer().toPNG).toHaveBeenCalled();
});

test("showDownload={false} hides the download control", async () => {
  const { container } = render(<AspicioPreview showDownload={false} />);
  await flush();
  expect(
    shadowOf(container, "aspicio-preview").querySelector('[aria-label="Download"]'),
  ).toBeNull();
});

test("shortcuts prop enables keyboard camera + show-all on the container", async () => {
  const { container } = render(<AspicioPreview shortcuts />);
  await flush();
  const el = shadowOf(container, "aspicio-preview").querySelector(".canvas-host") as HTMLElement;
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  expect(lastViewer().fitView).toHaveBeenCalled();
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  expect(lastViewer().setLayerVisible).toHaveBeenCalled(); // show-all unhides layers
});

test("shortcuts default off — no keyboard handling", async () => {
  const { container } = render(<AspicioPreview />);
  await flush();
  const el = shadowOf(container, "aspicio-preview").querySelector(".canvas-host") as HTMLElement;
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  expect(lastViewer().fitView).not.toHaveBeenCalled();
});

/* ---------- AspicioEmbed ---------- */

test("AspicioEmbed forwards showDownload to hide the download control", async () => {
  const { container } = render(<AspicioEmbed showDownload={false} />);
  await flush();
  expect(embedPreviewShadow(container).querySelector('[aria-label="Download"]')).toBeNull();
});

test("AspicioEmbed renders panel and preview together and loads src", async () => {
  const { container } = render(<AspicioEmbed src="dxf-data" style={{ height: 400 }} />);
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
  // Panel lists the loaded layers; preview container exists beside it.
  const panel = panelShadow(container);
  expect(rowByName(panel, "CUT")).toBeTruthy();
  expect(rowByName(panel, "MARK")).toBeTruthy();
  expect(panel.querySelectorAll("ul")).toHaveLength(1);
  expect(lastViewer().container).toBeTruthy();
});

test("AspicioEmbed panel interactions drive the viewer", async () => {
  const { container } = render(<AspicioEmbed src="dxf-data" />);
  await flush();
  const checkbox = panelShadow(container).querySelector<HTMLElement>('[aria-label="CUT"]');
  fireEvent.click(checkbox!);
  expect(lastViewer().setLayerVisible).toHaveBeenCalledWith("CUT", false);
});

test("AspicioEmbed panel=right docks the layer list after the preview", async () => {
  const { container } = render(<AspicioEmbed src="dxf-data" panel="right" />);
  await flush();
  const embed = shadowOf(container, "aspicio-embed");
  const panel = embed.querySelector("aspicio-layer-panel");
  expect(panel).not.toBeNull();
  expect(panel?.classList.contains("panel-right")).toBe(true);
  expect(rowByName(panel!.shadowRoot!, "CUT")).toBeTruthy();
});

test("AspicioEmbed with panel=none renders no layer list", async () => {
  const { container } = render(<AspicioEmbed src="dxf-data" panel="none" />);
  await flush();
  expect(shadowOf(container, "aspicio-embed").querySelector("aspicio-layer-panel")).toBeNull();
});

test("AspicioEmbed exposes the viewer via ref", async () => {
  const ref = createRef<DrawingViewer>();
  render(<AspicioEmbed src="dxf-data" ref={ref} />);
  await flush();
  expect(ref.current).toBe(lastViewer() as unknown as DrawingViewer);
});

test("AspicioEmbed is themed like the demo app by default", async () => {
  const { container } = render(<AspicioEmbed src="dxf-data" />);
  await flush();
  const embed = container.querySelector("aspicio-embed")!;
  // Themed chrome keys off the reflected theme attribute (host CSS).
  expect(embed.getAttribute("theme")).toBe("aspicio");
  expect(embed.shadowRoot?.querySelector(".canvas-grid")).not.toBeNull();
  // Themed embeds default to a transparent canvas so the grid shows through.
  expect(lastViewer().options).toMatchObject({ background: null });
});

test("AspicioEmbed theme=none drops the themed chrome", async () => {
  const { container } = render(<AspicioEmbed src="dxf-data" theme="none" />);
  await flush();
  const embed = container.querySelector("aspicio-embed")!;
  expect(embed.getAttribute("theme")).toBe("none");
  expect(embed.shadowRoot?.querySelector(".canvas-grid")).toBeNull();
  expect(panelShadow(container).querySelector(".panel")).toBeNull(); // minimal list
  expect(lastViewer().options?.background).toBeUndefined();
});

test("AspicioEmbed keeps an explicit background over the themed default", async () => {
  render(<AspicioEmbed src="dxf-data" options={{ background: 0x112233 }} />);
  await flush();
  expect(lastViewer().options).toMatchObject({ background: 0x112233 });
});

test("AspicioEmbed panelStyle reaches the inner panel (with px conversion)", async () => {
  const { container } = render(<AspicioEmbed src="dxf-data" panelStyle={{ width: 300 }} />);
  await flush();
  const panel = shadowOf(container, "aspicio-embed").querySelector(
    "aspicio-layer-panel",
  ) as HTMLElement;
  expect(panel.style.width).toBe("300px");
});

/* ---------- AspicioLayerPanel ---------- */

function renderPanel(extra: Partial<Parameters<typeof AspicioLayerPanel>[0]> = {}) {
  const viewer = new mock.MockViewer(document.createElement("div"));
  const utils = render(
    <AspicioLayerPanel viewer={viewer as unknown as DrawingViewer} {...extra} />,
  );
  const shadow = () => shadowOf(utils.container, "aspicio-layer-panel");
  return { viewer, shadow, ...utils };
}

test("renders one row per layer with effective-color swatches", async () => {
  const { shadow } = renderPanel();
  await flush();
  expect(rowByName(shadow(), "CUT")).toBeTruthy();
  expect(rowByName(shadow(), "MARK")).toBeTruthy();
  const swatches = shadow().querySelectorAll<HTMLElement>(".swatch");
  // CUT prefers effectiveColors[0] (red); MARK falls back to table color.
  expect(swatches[0].style.background).toContain("#ff0000");
  expect(swatches[1].style.background).toContain("#00ff00");
});

test("checkbox toggles layer visibility", async () => {
  const { viewer, shadow } = renderPanel();
  await flush();
  fireEvent.click(shadow().querySelector('[aria-label="CUT"]')!);
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("CUT", false);
});

test("row hover highlights the layer and clears on leave", async () => {
  const { viewer, shadow } = renderPanel();
  await flush();
  const row = rowByName(shadow(), "CUT");
  row.dispatchEvent(new MouseEvent("mouseenter"));
  expect(viewer.setLayerHighlight).toHaveBeenCalledWith("CUT");
  row.dispatchEvent(new MouseEvent("mouseleave"));
  expect(viewer.setLayerHighlight).toHaveBeenCalledWith(null);
});

test("re-syncs rows when the viewer loads a new document", async () => {
  const { viewer, shadow } = renderPanel();
  await flush();
  viewer.layers = [{ name: "NEW", color: 0x0000ff, visible: true, frozen: false, entityCount: 7 }];
  act(() => viewer.emit("loaded"));
  await flush();
  expect(rowByName(shadow(), "NEW")).toBeTruthy();
  expect([...shadow().querySelectorAll(".name")].map((n) => n.textContent?.trim())).toEqual([
    "NEW",
  ]);
});

test("themed panel shows a header with the layer count and a hints footer", async () => {
  const { shadow } = renderPanel();
  await flush();
  expect(shadow().querySelector(".header")?.textContent).toContain("LAYERS");
  expect(shadow().querySelector(".header-count")?.textContent?.trim()).toBe("2");
  expect(shadow().querySelector(".hints")?.textContent).toContain("solo layer");
});

test("hints footer can be disabled", async () => {
  const { shadow } = renderPanel({ hints: false });
  await flush();
  expect(shadow().querySelector(".hints")).toBeNull();
});

test("double-clicking a row solos it, then EXIT restores all layers", async () => {
  const { viewer, shadow } = renderPanel();
  await flush();
  fireEvent.dblClick(rowByName(shadow(), "CUT"));
  await flush();
  // Solo hides every other layer and shows the banner (EXIT is unique to it).
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("MARK", false);
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("CUT", true);
  const exit = shadow().querySelector<HTMLElement>(".solo-exit");
  expect(exit).not.toBeNull();

  viewer.setLayerVisible.mockClear();
  fireEvent.click(exit!);
  await flush();
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("MARK", true);
  expect(shadow().querySelector(".solo-exit")).toBeNull();
});

test("reverseHighlightLayer marks the matching row", async () => {
  const { shadow } = renderPanel({ reverseHighlightLayer: "CUT" });
  await flush();
  // The reverse-highlighted row gets the accent treatment; the other doesn't.
  expect(rowByName(shadow(), "CUT").classList.contains("reverse")).toBe(true);
  expect(rowByName(shadow(), "MARK").classList.contains("reverse")).toBe(false);
});

/* ---------- AspicioPreview canvas hover-picking ---------- */

test("onHoverLayer reports the picked layer and highlights it", async () => {
  const onHoverLayer = vi.fn();
  const { container } = render(<AspicioPreview src="dxf-data" onHoverLayer={onHoverLayer} />);
  await flush();
  const host = shadowOf(container, "aspicio-preview").querySelector(".canvas-host") as HTMLElement;
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

test("AspicioEmbed wires canvas hover to the panel's reverse-highlight", async () => {
  const { container } = render(<AspicioEmbed src="dxf-data" />);
  await flush();
  const host = embedPreviewShadow(container).querySelector(".canvas-host") as HTMLElement;
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
  await flush();

  expect(rowByName(panelShadow(container), "CUT").classList.contains("reverse")).toBe(true);
});
