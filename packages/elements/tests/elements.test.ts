// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { LayerInfo } from "@aspicio/core";

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

import type { AspicioEmbed, AspicioLayerPanel, AspicioPreview } from "../src/index.ts";
import "../src/index.ts";

/* ---------- helpers ---------- */

/** Settle Lit renders and load-promise chains. */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const lastViewer = () => mock.instances[mock.instances.length - 1];

function mount<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  assign: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, assign);
  document.body.appendChild(el);
  return el;
}

const shadow = (el: Element): ShadowRoot => {
  const root = el.shadowRoot;
  if (!root) throw new Error("no shadow root");
  return root;
};

const panelOf = (embed: AspicioEmbed): AspicioLayerPanel | null =>
  shadow(embed).querySelector("aspicio-layer-panel");
const previewOf = (embed: AspicioEmbed): AspicioPreview => {
  const preview = shadow(embed).querySelector("aspicio-preview");
  if (!preview) throw new Error("no preview");
  return preview;
};
const rowNames = (panel: AspicioLayerPanel): string[] =>
  [...shadow(panel).querySelectorAll(".name")].map((n) => n.textContent?.trim() ?? "");
const rowByName = (panel: AspicioLayerPanel, name: string): HTMLElement => {
  const row = [...shadow(panel).querySelectorAll<HTMLElement>(".row")].find(
    (r) => r.querySelector(".name")?.textContent?.trim() === name,
  );
  if (!row) throw new Error(`row ${name} not found`);
  return row;
};

function makePanel(): { viewer: InstanceType<typeof mock.MockViewer>; panel: AspicioLayerPanel } {
  const viewer = new mock.MockViewer(document.createElement("div"));
  const panel = mount("aspicio-layer-panel");
  panel.viewer = viewer as never;
  return { viewer, panel };
}

beforeEach(() => {
  mock.instances.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  document.body.innerHTML = "";
});

/* ---------- <aspicio-preview> ---------- */

test("mounts a viewer into the shadow container and disposes on disconnect", async () => {
  const el = mount("aspicio-preview");
  await flush();
  expect(mock.instances).toHaveLength(1);
  expect(lastViewer().container).toBe(shadow(el).querySelector(".canvas-host"));
  expect(el.viewer).toBe(lastViewer() as never);
  el.remove();
  expect(lastViewer().disposed).toBe(true);
  expect(el.viewer).toBeNull();
});

test("recreates the viewer when reconnected", async () => {
  const el = mount("aspicio-preview");
  await flush();
  el.remove();
  expect(mock.instances).toHaveLength(1);
  document.body.appendChild(el);
  await flush();
  expect(mock.instances).toHaveLength(2);
  expect(lastViewer().disposed).toBe(false);
});

test("loads the src property and fires `loaded` with layers and stats", async () => {
  const onLoaded = vi.fn();
  const el = mount("aspicio-preview", { src: "dxf-data" });
  el.addEventListener("loaded", (e) => onLoaded((e as CustomEvent).detail));
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
  expect(lastViewer().load).toHaveBeenCalledTimes(1);
  expect(onLoaded).toHaveBeenCalledWith({
    layers: lastViewer().layers,
    stats: { entityCount: 4, segmentCount: 9, unsupported: {} },
  });
});

test("the src-url attribute uses loadUrl", async () => {
  const el = mount("aspicio-preview");
  el.setAttribute("src-url", "/plan.dxf");
  await flush();
  expect(lastViewer().loadUrl).toHaveBeenCalledWith("/plan.dxf");
  expect(lastViewer().load).not.toHaveBeenCalled();
});

test("a newer src supersedes a slow in-flight load", async () => {
  const loaded = vi.fn();
  const el = mount("aspicio-preview", { src: "first" });
  el.addEventListener("loaded", loaded);
  await flush();
  let finishSecond: () => void = () => {};
  lastViewer().load.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finishSecond = resolve)),
  );

  el.src = "second";
  await el.updateComplete;
  el.src = "third";
  await flush();
  finishSecond();
  await flush();
  const calls = lastViewer().load.mock.calls.map(([arg]) => arg);
  expect(calls).toEqual(["first", "second", "third"]);
  expect(loaded).toHaveBeenCalledTimes(2); // first + third, not second
});

test("`load-error` fires for failed loads", async () => {
  const onError = vi.fn();
  const el = mount("aspicio-preview", { src: "ok" });
  el.addEventListener("load-error", (e) => onError((e as CustomEvent).detail.error));
  await flush();
  lastViewer().load.mockRejectedValueOnce(new Error("boom"));
  el.src = "broken";
  await flush();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
});

test("`viewer-change` fires on create and disconnect", async () => {
  const seen: unknown[] = [];
  const el = document.createElement("aspicio-preview");
  el.addEventListener("viewer-change", (e) => seen.push((e as CustomEvent).detail.viewer));
  document.body.appendChild(el);
  await flush();
  expect(seen).toEqual([lastViewer()]);
  el.remove();
  expect(seen).toEqual([lastViewer(), null]);
});

test("changed options recreate the viewer; same-value options don't", async () => {
  const el = mount("aspicio-preview", { options: { background: 0x112233 } });
  await flush();
  expect(mock.instances).toHaveLength(1);
  el.options = { background: 0x112233 }; // new identity, same value
  await flush();
  expect(mock.instances).toHaveLength(1);
  el.options = { background: 0x445566 };
  await flush();
  expect(mock.instances).toHaveLength(2);
  expect(mock.instances[0].disposed).toBe(true);
  expect(lastViewer().options).toMatchObject({ background: 0x445566 });
});

test("shows the download control by default and exports on click", async () => {
  const el = mount("aspicio-preview");
  await flush();
  const btn = shadow(el).querySelector<HTMLElement>('[aria-label="Download"]');
  expect(btn).not.toBeNull();
  btn?.click();
  await flush();
  const png = [...shadow(el).querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "PNG",
  );
  png?.click();
  expect(lastViewer().toPNG).toHaveBeenCalled();
});

test("the no-download attribute hides the download control", async () => {
  const el = mount("aspicio-preview");
  el.setAttribute("no-download", "");
  await flush();
  expect(shadow(el).querySelector('[aria-label="Download"]')).toBeNull();
});

test("the shortcuts attribute enables keyboard camera + show-all on the container", async () => {
  const el = mount("aspicio-preview");
  el.setAttribute("shortcuts", "");
  await flush();
  const container = shadow(el).querySelector(".canvas-host") as HTMLElement;
  container.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  expect(lastViewer().fitView).toHaveBeenCalled();
  container.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  expect(lastViewer().setLayerVisible).toHaveBeenCalled();
});

test("shortcuts default off — no keyboard handling", async () => {
  const el = mount("aspicio-preview");
  await flush();
  const container = shadow(el).querySelector(".canvas-host") as HTMLElement;
  container.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  expect(lastViewer().fitView).not.toHaveBeenCalled();
});

test("hover-pick reports the picked layer via `hover-layer` and highlights it", async () => {
  const onHover = vi.fn();
  const el = mount("aspicio-preview", { src: "dxf-data" });
  el.setAttribute("hover-pick", "");
  el.addEventListener("hover-layer", (e) => onHover((e as CustomEvent).detail.layer));
  await flush();
  const container = shadow(el).querySelector(".canvas-host") as HTMLElement;
  container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  container.dispatchEvent(
    new PointerEvent("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(lastViewer().pickLayer).toHaveBeenCalled();
  expect(onHover).toHaveBeenCalledWith("CUT");
  expect(lastViewer().setLayerHighlight).toHaveBeenCalledWith("CUT");
});

test("without hover-pick, pointer movement picks nothing", async () => {
  const el = mount("aspicio-preview", { src: "dxf-data" });
  await flush();
  const container = shadow(el).querySelector(".canvas-host") as HTMLElement;
  container.dispatchEvent(
    new PointerEvent("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(lastViewer().pickLayer).not.toHaveBeenCalled();
});

/* ---------- <aspicio-layer-panel> ---------- */

test("renders one row per layer with effective-color swatches", async () => {
  const { panel } = makePanel();
  await flush();
  expect(rowNames(panel)).toEqual(["CUT", "MARK"]);
  const swatches = shadow(panel).querySelectorAll<HTMLElement>(".swatch");
  // CUT prefers effectiveColors[0] (red); MARK falls back to table color.
  expect(swatches[0].style.background).toContain("#ff0000");
  expect(swatches[1].style.background).toContain("#00ff00");
});

test("checkbox toggles layer visibility", async () => {
  const { viewer, panel } = makePanel();
  await flush();
  shadow(panel).querySelector<HTMLElement>('[aria-label="CUT"]')?.click();
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("CUT", false);
});

test("row hover highlights the layer and clears on leave", async () => {
  const { viewer, panel } = makePanel();
  await flush();
  const row = rowByName(panel, "CUT");
  row.dispatchEvent(new MouseEvent("mouseenter"));
  expect(viewer.setLayerHighlight).toHaveBeenCalledWith("CUT");
  row.dispatchEvent(new MouseEvent("mouseleave"));
  expect(viewer.setLayerHighlight).toHaveBeenCalledWith(null);
});

test("re-syncs rows when the viewer loads a new document", async () => {
  const { viewer, panel } = makePanel();
  await flush();
  viewer.layers = [{ name: "NEW", color: 0x0000ff, visible: true, frozen: false, entityCount: 7 }];
  viewer.emit("loaded");
  await flush();
  expect(rowNames(panel)).toEqual(["NEW"]);
});

test("themed panel shows a header with the layer count and a hints footer", async () => {
  const { panel } = makePanel();
  await flush();
  const root = shadow(panel);
  expect(root.querySelector(".header")?.textContent).toContain("LAYERS");
  expect(root.querySelector(".header-count")?.textContent?.trim()).toBe("2");
  expect(root.querySelector(".hints")?.textContent).toContain("solo layer");
});

test("the no-hints attribute disables the hints footer", async () => {
  const { panel } = makePanel();
  panel.setAttribute("no-hints", "");
  await flush();
  expect(shadow(panel).querySelector(".hints")).toBeNull();
});

test("double-clicking a row solos it, then EXIT restores all layers", async () => {
  const { viewer, panel } = makePanel();
  await flush();
  rowByName(panel, "CUT").dispatchEvent(new MouseEvent("dblclick", { cancelable: true }));
  await flush();
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("MARK", false);
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("CUT", true);
  const exit = shadow(panel).querySelector<HTMLElement>(".solo-exit");
  expect(exit).not.toBeNull();

  viewer.setLayerVisible.mockClear();
  exit?.click();
  await flush();
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("MARK", true);
  expect(shadow(panel).querySelector(".solo-exit")).toBeNull();
});

test("reverse-highlight-layer marks the matching row", async () => {
  const { panel } = makePanel();
  panel.setAttribute("reverse-highlight-layer", "CUT");
  await flush();
  expect(rowByName(panel, "CUT").classList.contains("reverse")).toBe(true);
  expect(rowByName(panel, "MARK").classList.contains("reverse")).toBe(false);
});

test("theme=none renders the minimal list with native checkboxes", async () => {
  const { viewer, panel } = makePanel();
  panel.setAttribute("theme", "none");
  await flush();
  const root = shadow(panel);
  expect(root.querySelector(".panel")).toBeNull(); // no themed chrome
  expect(root.querySelector(".hints")).toBeNull();
  const checkbox = root.querySelector<HTMLInputElement>('input[aria-label="CUT"]');
  expect(checkbox).not.toBeNull();
  checkbox?.dispatchEvent(new Event("change"));
  expect(viewer.setLayerVisible).toHaveBeenCalledWith("CUT", false);
});

/* ---------- <aspicio-embed> ---------- */

test("renders panel and preview together and loads src", async () => {
  const embed = mount("aspicio-embed", { src: "dxf-data" });
  await flush();
  expect(lastViewer().load).toHaveBeenCalledWith("dxf-data");
  const panel = panelOf(embed);
  expect(panel).not.toBeNull();
  expect(rowNames(panel as AspicioLayerPanel)).toEqual(["CUT", "MARK"]);
  expect(embed.viewer).toBe(lastViewer() as never);
});

test("panel=right docks the layer list after the preview", async () => {
  const embed = mount("aspicio-embed", { src: "dxf-data" });
  embed.setAttribute("panel", "right");
  await flush();
  const panel = panelOf(embed);
  expect(panel).not.toBeNull();
  expect(panel?.classList.contains("panel-right")).toBe(true);
  // The panel sits after the canvas wrap, so it docks on the right in flex order.
  const children = [...shadow(embed).children].filter((c) => c.tagName !== "STYLE");
  expect(children.indexOf(panel as Element)).toBeGreaterThan(
    children.findIndex((c) => c.classList.contains("canvas-wrap")),
  );
  expect(rowNames(panel as AspicioLayerPanel)).toEqual(["CUT", "MARK"]);
});

test("panel=none renders no layer list", async () => {
  const embed = mount("aspicio-embed", { src: "dxf-data" });
  embed.setAttribute("panel", "none");
  await flush();
  expect(panelOf(embed)).toBeNull();
});

test("panel interactions drive the viewer", async () => {
  const embed = mount("aspicio-embed", { src: "dxf-data" });
  await flush();
  const panel = panelOf(embed) as AspicioLayerPanel;
  shadow(panel).querySelector<HTMLElement>('[aria-label="CUT"]')?.click();
  expect(lastViewer().setLayerVisible).toHaveBeenCalledWith("CUT", false);
});

test("no-download forwards to the inner preview", async () => {
  const embed = mount("aspicio-embed", { src: "dxf-data" });
  embed.setAttribute("no-download", "");
  await flush();
  expect(shadow(previewOf(embed)).querySelector('[aria-label="Download"]')).toBeNull();
});

test("themed embeds default to a transparent canvas so the grid shows through", async () => {
  const embed = mount("aspicio-embed", { src: "dxf-data" });
  await flush();
  expect(lastViewer().options).toMatchObject({ background: null });
  expect(shadow(embed).querySelector(".canvas-grid")).not.toBeNull();
});

test("theme=none passes options through and drops the themed chrome", async () => {
  const embed = mount("aspicio-embed", { src: "dxf-data" });
  embed.setAttribute("theme", "none");
  await flush();
  expect(lastViewer().options?.background).toBeUndefined();
  expect(shadow(embed).querySelector(".canvas-grid")).toBeNull();
});

test("an explicit background wins over the themed default", async () => {
  mount("aspicio-embed", { src: "dxf-data", options: { background: 0x112233 } });
  await flush();
  expect(lastViewer().options).toMatchObject({ background: 0x112233 });
});

test("re-dispatches `loaded` from the embed element", async () => {
  const onLoaded = vi.fn();
  const embed = document.createElement("aspicio-embed");
  embed.src = "dxf-data";
  embed.addEventListener("loaded", (e) => onLoaded((e as CustomEvent).detail));
  document.body.appendChild(embed);
  await flush();
  expect(onLoaded).toHaveBeenCalledWith(
    expect.objectContaining({ stats: { entityCount: 4, segmentCount: 9, unsupported: {} } }),
  );
});

test("canvas hover reverse-highlights the matching panel row", async () => {
  const embed = mount("aspicio-embed", { src: "dxf-data" });
  await flush();
  const container = shadow(previewOf(embed)).querySelector(".canvas-host") as HTMLElement;
  container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  container.dispatchEvent(
    new PointerEvent("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await flush();
  const panel = panelOf(embed) as AspicioLayerPanel;
  expect(rowByName(panel, "CUT").classList.contains("reverse")).toBe(true);
});

test("panelStyle applies to the panel element via CSSOM", async () => {
  const embed = mount("aspicio-embed", { src: "dxf-data" });
  embed.panelStyle = { width: "300px" };
  await flush();
  const panel = panelOf(embed) as HTMLElement;
  expect(panel.style.width).toBe("300px");
});

/* ---------- registration ---------- */

test("all three elements are registered exactly once", () => {
  expect(customElements.get("aspicio-embed")).toBeDefined();
  expect(customElements.get("aspicio-preview")).toBeDefined();
  expect(customElements.get("aspicio-layer-panel")).toBeDefined();
});

/* Type-level sanity: LayerInfo flows through the panel's viewer property. */
const _typecheck = (panel: AspicioLayerPanel): LayerInfo[] | undefined => panel.viewer?.getLayers();
void _typecheck;
