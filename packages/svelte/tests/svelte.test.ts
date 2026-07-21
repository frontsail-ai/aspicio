// @vitest-environment happy-dom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { DxfViewer } from "@aspicio/core";

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
    toSVG = vi.fn(() => "<svg></svg>");
    toPNG = vi.fn(() => "data:image/png;base64,AAAA");
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
  }
  const instances: MockViewer[] = [];
  return { MockViewer, instances };
});

vi.mock("@aspicio/core", () => ({
  DxfViewer: mock.MockViewer,
  attachShortcuts: (target: EventTarget, viewer: { fitView: () => void }) => {
    const onKey = (ev: Event): void => {
      if ((ev as KeyboardEvent).key.toLowerCase() === "f") viewer.fitView();
    };
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  },
}));

import { DxfEmbed, DxfLayerPanel, DxfPreview } from "../src/index.js";

/* ---------- helpers ---------- */

const flush = async (): Promise<void> => {
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const lastViewer = () => mock.instances[mock.instances.length - 1];

const shadow = (el: Element | null): ShadowRoot => {
  if (!el?.shadowRoot) throw new Error("no shadow root");
  return el.shadowRoot;
};
const previewEl = () => document.querySelector("aspicio-preview");
const embedEl = () => document.querySelector("aspicio-embed");

type Handle = { viewer(): DxfViewer | null };
const mountC = (component: unknown, props: Record<string, unknown>): Handle =>
  mount(component as never, { target: document.body, props }) as unknown as Handle;

beforeEach(() => {
  mock.instances.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  document.body.innerHTML = "";
});

/* ---------- DxfPreview ---------- */

test("mounts a viewer and disposes on unmount", async () => {
  const app = mountC(DxfPreview, {});
  await flush();
  expect(mock.instances).toHaveLength(1);
  expect(lastViewer().container).toBe(shadow(previewEl()).querySelector(".canvas-host"));
  expect(app.viewer()).toBe(lastViewer() as unknown as DxfViewer);
  void unmount(app as never);
  expect(lastViewer().disposed).toBe(true);
});

test("loads src and calls onloaded with layers and stats", async () => {
  const onloaded = vi.fn();
  mountC(DxfPreview, { src: "dxf-data", onloaded });
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
  expect(lastViewer().load).toHaveBeenCalledTimes(1);
  expect(onloaded).toHaveBeenCalledWith({
    layers: lastViewer().layers,
    stats: { entityCount: 4, segmentCount: 9, unsupported: {} },
  });
});

test("srcUrl uses loadUrl; assigning src afterwards wins", async () => {
  let el: Element | null = null;
  mountC(DxfPreview, { srcUrl: "/plan.dxf" });
  await flush();
  expect(lastViewer().loadUrl).toHaveBeenCalledWith("/plan.dxf");
  el = previewEl();
  (el as Element & { src: string }).src = "dxf-data"; // lingering src-url attr
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
});

test("onloaderror fires for failed loads", async () => {
  const onloaderror = vi.fn();
  mountC(DxfPreview, { src: "ok", onloaderror });
  await flush();
  lastViewer().load.mockRejectedValueOnce(new Error("boom"));
  (previewEl() as Element & { src: string }).src = "broken";
  await flush();
  expect(onloaderror).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
});

test("onviewerchange reports the instance; showDownload=false hides the control", async () => {
  const onviewerchange = vi.fn();
  mountC(DxfPreview, { showDownload: false, onviewerchange });
  await flush();
  expect(onviewerchange).toHaveBeenCalledWith(lastViewer());
  expect(shadow(previewEl()).querySelector('[aria-label="Download"]')).toBeNull();
});

test("shortcuts prop wires keyboard control", async () => {
  mountC(DxfPreview, { shortcuts: true });
  await flush();
  const container = shadow(previewEl()).querySelector(".canvas-host") as HTMLElement;
  container.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  expect(lastViewer().fitView).toHaveBeenCalled();
});

test("providing onhoverlayer enables canvas hover-picking", async () => {
  const onhoverlayer = vi.fn();
  mountC(DxfPreview, { src: "dxf-data", onhoverlayer });
  await flush();
  const container = shadow(previewEl()).querySelector(".canvas-host") as HTMLElement;
  container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  container.dispatchEvent(
    new PointerEvent("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(lastViewer().pickLayer).toHaveBeenCalled();
  expect(onhoverlayer).toHaveBeenCalledWith("CUT");
});

test("without onhoverlayer, picking stays off", async () => {
  mountC(DxfPreview, { src: "dxf-data" });
  await flush();
  const container = shadow(previewEl()).querySelector(".canvas-host") as HTMLElement;
  container.dispatchEvent(
    new PointerEvent("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(lastViewer().pickLayer).not.toHaveBeenCalled();
});

/* ---------- DxfEmbed ---------- */

test("renders panel and preview together and loads src", async () => {
  const app = mountC(DxfEmbed, { src: "dxf-data" });
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
  const panel = shadow(embedEl()).querySelector("aspicio-layer-panel");
  expect(panel).not.toBeNull();
  const names = [...shadow(panel).querySelectorAll(".name")].map((n) => n.textContent?.trim());
  expect(names).toEqual(["CUT", "MARK"]);
  expect(app.viewer()).toBe(lastViewer() as unknown as DxfViewer);
});

test("panel=right docks after the preview; theme=none drops the chrome", async () => {
  mountC(DxfEmbed, { src: "dxf-data", panel: "right", theme: "none" });
  await flush();
  const embed = embedEl() as Element;
  const panel = shadow(embed).querySelector("aspicio-layer-panel");
  expect(panel?.classList.contains("panel-right")).toBe(true);
  expect(embed.getAttribute("theme")).toBe("none");
  expect(shadow(embed).querySelector(".canvas-grid")).toBeNull();
});

test("themed embeds default to a transparent canvas; explicit background wins", async () => {
  mountC(DxfEmbed, { src: "dxf-data" });
  await flush();
  expect(lastViewer().options).toMatchObject({ background: null });

  mock.instances.length = 0;
  mountC(DxfEmbed, { src: "dxf-data", options: { background: 0x112233 } });
  await flush();
  expect(lastViewer().options).toMatchObject({ background: 0x112233 });
});

test("panelStyle reaches the inner panel via CSSOM", async () => {
  mountC(DxfEmbed, { src: "dxf-data", panelStyle: { width: "300px" } });
  await flush();
  const panel = shadow(embedEl()).querySelector("aspicio-layer-panel") as HTMLElement;
  expect(panel.style.width).toBe("300px");
});

test("canvas hover reverse-highlights the matching panel row", async () => {
  mountC(DxfEmbed, { src: "dxf-data" });
  await flush();
  const preview = shadow(embedEl()).querySelector("aspicio-preview");
  const container = shadow(preview).querySelector(".canvas-host") as HTMLElement;
  container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  container.dispatchEvent(
    new PointerEvent("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await flush();
  const panel = shadow(embedEl()).querySelector("aspicio-layer-panel");
  const reversed = [...shadow(panel).querySelectorAll(".row")].find((r) =>
    r.classList.contains("reverse"),
  );
  expect(reversed?.querySelector(".name")?.textContent?.trim()).toBe("CUT");
});

/* ---------- DxfLayerPanel ---------- */

test("drives the viewer through the panel", async () => {
  const viewer = new mock.MockViewer(document.createElement("div"));
  mountC(DxfLayerPanel, { viewer: viewer as unknown as DxfViewer });
  await flush();
  const panel = document.querySelector("aspicio-layer-panel");
  shadow(panel).querySelector<HTMLElement>('[aria-label="CUT"]')?.click();
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("CUT", false);
});

test("reverseHighlightLayer and hints flow through", async () => {
  const viewer = new mock.MockViewer(document.createElement("div"));
  mountC(DxfLayerPanel, {
    viewer: viewer as unknown as DxfViewer,
    reverseHighlightLayer: "CUT",
    hints: false,
  });
  await flush();
  const panel = document.querySelector("aspicio-layer-panel");
  const rows = [...shadow(panel).querySelectorAll(".row")];
  expect(rows.find((r) => r.classList.contains("reverse"))).toBeTruthy();
  expect(shadow(panel).querySelector(".hints")).toBeNull();
});
