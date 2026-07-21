// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { DxfViewer } from "@aspicio/core";
import { DxfEmbed } from "../src/DxfEmbed.ts";
import { DxfLayerPanel } from "../src/DxfLayerPanel.ts";
import { DxfPreview } from "../src/DxfPreview.ts";

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

/* ---------- helpers ---------- */

const flush = async (): Promise<void> => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const lastViewer = () => mock.instances[mock.instances.length - 1];

const shadow = (el: Element | null): ShadowRoot => {
  if (!el?.shadowRoot) throw new Error("no shadow root");
  return el.shadowRoot;
};
const embedShadow = (wrapper: { element: Element }): ShadowRoot =>
  shadow(wrapper.element.matches("aspicio-embed") ? wrapper.element : null);

beforeEach(() => {
  mock.instances.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  document.body.innerHTML = "";
});

/* ---------- DxfPreview ---------- */

test("mounts a viewer and disposes on unmount", async () => {
  const w = mount(DxfPreview, { attachTo: document.body });
  await flush();
  expect(mock.instances).toHaveLength(1);
  expect(lastViewer().container).toBe(shadow(w.element).querySelector(".canvas-host"));
  w.unmount();
  expect(lastViewer().disposed).toBe(true);
});

test("loads src and emits `loaded` with layers and stats", async () => {
  const w = mount(DxfPreview, { props: { src: "dxf-data" }, attachTo: document.body });
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
  expect(lastViewer().load).toHaveBeenCalledTimes(1);
  expect(w.emitted("loaded")?.[0]?.[0]).toEqual({
    layers: lastViewer().layers,
    stats: { entityCount: 4, segmentCount: 9, unsupported: {} },
  });
});

test("srcUrl uses loadUrl; switching to src wins afterwards", async () => {
  const w = mount(DxfPreview, { props: { srcUrl: "/plan.dxf" }, attachTo: document.body });
  await flush();
  expect(lastViewer().loadUrl).toHaveBeenCalledWith("/plan.dxf");
  await w.setProps({ src: "dxf-data" });
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
});

test("emits `load-error` for failed loads", async () => {
  const w = mount(DxfPreview, { props: { src: "ok" }, attachTo: document.body });
  await flush();
  lastViewer().load.mockRejectedValueOnce(new Error("boom"));
  await w.setProps({ src: "broken" });
  await flush();
  const [error] = w.emitted("load-error")?.[0] ?? [];
  expect((error as Error).message).toBe("boom");
});

test("exposes the viewer and emits `viewer-change`", async () => {
  const w = mount(DxfPreview, { attachTo: document.body });
  await flush();
  expect((w.vm as unknown as { viewer: DxfViewer }).viewer).toBe(
    lastViewer() as unknown as DxfViewer,
  );
  expect(w.emitted("viewer-change")?.[0]?.[0]).toBe(lastViewer());
});

test("showDownload=false hides the download control", async () => {
  const w = mount(DxfPreview, { props: { showDownload: false }, attachTo: document.body });
  await flush();
  expect(shadow(w.element).querySelector('[aria-label="Download"]')).toBeNull();
  await w.setProps({ showDownload: true });
  await flush();
  expect(shadow(w.element).querySelector('[aria-label="Download"]')).not.toBeNull();
});

test("shortcuts prop wires keyboard control", async () => {
  const w = mount(DxfPreview, { props: { shortcuts: true }, attachTo: document.body });
  await flush();
  const container = shadow(w.element).querySelector(".canvas-host") as HTMLElement;
  container.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  expect(lastViewer().fitView).toHaveBeenCalled();
});

test("binding @hover-layer enables canvas hover-picking", async () => {
  const onHover = vi.fn();
  const w = mount(DxfPreview, {
    props: { src: "dxf-data", "onHover-layer": onHover },
    attachTo: document.body,
  });
  await flush();
  const container = shadow(w.element).querySelector(".canvas-host") as HTMLElement;
  container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  container.dispatchEvent(
    new PointerEvent("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(lastViewer().pickLayer).toHaveBeenCalled();
  expect(onHover).toHaveBeenCalledWith("CUT");
});

test("without a hover-layer listener, picking stays off", async () => {
  const w = mount(DxfPreview, { props: { src: "dxf-data" }, attachTo: document.body });
  await flush();
  const container = shadow(w.element).querySelector(".canvas-host") as HTMLElement;
  container.dispatchEvent(
    new PointerEvent("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(lastViewer().pickLayer).not.toHaveBeenCalled();
});

/* ---------- DxfEmbed ---------- */

test("renders panel and preview together and loads src", async () => {
  const w = mount(DxfEmbed, { props: { src: "dxf-data" }, attachTo: document.body });
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
  const panel = embedShadow(w).querySelector("aspicio-layer-panel");
  expect(panel).not.toBeNull();
  const names = [...shadow(panel).querySelectorAll(".name")].map((n) => n.textContent?.trim());
  expect(names).toEqual(["CUT", "MARK"]);
});

test("panel=right docks after the preview; panel=none hides it", async () => {
  const w = mount(DxfEmbed, {
    props: { src: "dxf-data", panel: "right" },
    attachTo: document.body,
  });
  await flush();
  const panel = embedShadow(w).querySelector("aspicio-layer-panel");
  expect(panel?.classList.contains("panel-right")).toBe(true);
  await w.setProps({ panel: "none" });
  await flush();
  expect(embedShadow(w).querySelector("aspicio-layer-panel")).toBeNull();
});

test("themed embeds default to a transparent canvas; explicit background wins", async () => {
  mount(DxfEmbed, { props: { src: "dxf-data" }, attachTo: document.body });
  await flush();
  expect(lastViewer().options).toMatchObject({ background: null });

  mock.instances.length = 0;
  mount(DxfEmbed, {
    props: { src: "dxf-data", options: { background: 0x112233 } },
    attachTo: document.body,
  });
  await flush();
  expect(lastViewer().options).toMatchObject({ background: 0x112233 });
});

test("panelStyle reaches the inner panel via CSSOM", async () => {
  const w = mount(DxfEmbed, {
    props: { src: "dxf-data", panelStyle: { width: "300px" } },
    attachTo: document.body,
  });
  await flush();
  const panel = embedShadow(w).querySelector("aspicio-layer-panel") as HTMLElement;
  expect(panel.style.width).toBe("300px");
});

test("re-emits loaded / viewer-change and exposes the viewer", async () => {
  const w = mount(DxfEmbed, { props: { src: "dxf-data" }, attachTo: document.body });
  await flush();
  expect(w.emitted("loaded")).toHaveLength(1);
  expect(w.emitted("viewer-change")?.[0]?.[0]).toBe(lastViewer());
  expect((w.vm as unknown as { viewer: DxfViewer }).viewer).toBe(
    lastViewer() as unknown as DxfViewer,
  );
});

test("canvas hover reverse-highlights the matching panel row", async () => {
  const w = mount(DxfEmbed, { props: { src: "dxf-data" }, attachTo: document.body });
  await flush();
  const preview = embedShadow(w).querySelector("aspicio-preview");
  const container = shadow(preview).querySelector(".canvas-host") as HTMLElement;
  container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  container.dispatchEvent(
    new PointerEvent("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await flush();
  const panel = embedShadow(w).querySelector("aspicio-layer-panel");
  const reversed = [...shadow(panel).querySelectorAll(".row")].find((r) =>
    r.classList.contains("reverse"),
  );
  expect(reversed?.querySelector(".name")?.textContent?.trim()).toBe("CUT");
});

/* ---------- DxfLayerPanel ---------- */

test("drives the viewer through the panel, unwrapping reactive proxies", async () => {
  const raw = new mock.MockViewer(document.createElement("div"));
  // A viewer held in reactive state arrives as a proxy — the veneer must
  // hand the element the raw instance.
  const proxied = reactive(raw) as unknown as DxfViewer;
  const w = mount(DxfLayerPanel, { props: { viewer: proxied }, attachTo: document.body });
  await flush();
  const el = w.element as Element & { viewer: unknown };
  expect(el.viewer).toBe(raw);
  shadow(w.element).querySelector<HTMLElement>('[aria-label="CUT"]')?.click();
  expect(raw.setLayerVisible).toHaveBeenCalledWith("CUT", false);
});

test("reverseHighlightLayer and hints flow through", async () => {
  const viewer = new mock.MockViewer(document.createElement("div")) as unknown as DxfViewer;
  const w = mount(DxfLayerPanel, {
    props: { viewer, reverseHighlightLayer: "CUT", hints: false },
    attachTo: document.body,
  });
  await flush();
  const rows = [...shadow(w.element).querySelectorAll(".row")];
  expect(rows.find((r) => r.classList.contains("reverse"))).toBeTruthy();
  expect(shadow(w.element).querySelector(".hints")).toBeNull();
});
