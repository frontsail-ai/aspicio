import "./style.css";
import { DxfViewer } from "@observo/core";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <header class="topbar">
    <span class="brand">Observo</span>
    <button id="open" type="button">Open DXF</button>
    <button id="load-sample" type="button">Sample</button>
    <span id="status" class="status"></span>
    <button id="toggle-layers" type="button" class="layers-toggle">Layers</button>
  </header>
  <div class="body">
    <aside id="panel" class="panel">
      <h2>Layers</h2>
      <ul id="layer-list" class="layer-list"></ul>
      <p class="hint">
        Drag to pan · wheel/pinch to zoom · Shift+drag or two-finger twist to
        rotate · double click/tap to fit · hover a layer to highlight it ·
        double click a layer to solo it
      </p>
    </aside>
    <main id="viewer" class="viewer"></main>
  </div>
  <input id="file" type="file" accept=".dxf" hidden>
  <div id="drop" class="drop-overlay" hidden><span>Drop DXF to open</span></div>
`;

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = app.querySelector<T>(selector);
  if (!el) throw new Error(`${selector} not found`);
  return el;
};

const viewerEl = $<HTMLElement>("#viewer");
const statusEl = $<HTMLElement>("#status");
const layerList = $<HTMLUListElement>("#layer-list");
const fileInput = $<HTMLInputElement>("#file");
const dropOverlay = $<HTMLElement>("#drop");
const panel = $<HTMLElement>("#panel");

const viewer = new DxfViewer(viewerEl);
let currentName = "";
let soloLayer: string | null = null;
let hoveredLayer: string | null = null;
const layerRows = new Map<string, { item: HTMLLIElement; checkbox: HTMLInputElement }>();

function setStatus(text: string): void {
  statusEl.textContent = text;
}

/** Show only `name`; if it is already the solo layer, restore all layers. */
function toggleSolo(name: string): void {
  const layers = viewer.getLayers();
  if (soloLayer === name) {
    soloLayer = null;
    for (const layer of layers) viewer.setLayerVisible(layer.name, true);
  } else {
    soloLayer = name;
    for (const layer of layers) viewer.setLayerVisible(layer.name, layer.name === name);
  }
  syncLayerCheckboxes();
}

function syncLayerCheckboxes(): void {
  for (const layer of viewer.getLayers()) {
    const row = layerRows.get(layer.name);
    if (row) row.checkbox.checked = layer.visible;
  }
}

function updateHoveredRow(name: string | null): void {
  if (name === hoveredLayer) return;
  hoveredLayer = name;
  for (const [layerName, row] of layerRows) {
    row.item.classList.toggle("hovered", layerName === name);
  }
}

function rebuildLayerPanel(): void {
  layerList.textContent = "";
  layerRows.clear();
  for (const layer of viewer.getLayers()) {
    const item = document.createElement("li");
    const label = document.createElement("label");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = layer.visible;
    checkbox.addEventListener("change", () => {
      viewer.setLayerVisible(layer.name, checkbox.checked);
    });

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = `#${layer.color.toString(16).padStart(6, "0")}`;

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name;

    const count = document.createElement("span");
    count.className = "layer-count";
    count.textContent = String(layer.entityCount);

    label.append(checkbox, swatch, name, count);
    label.addEventListener("mouseenter", () => viewer.setLayerHighlight(layer.name));
    label.addEventListener("mouseleave", () => viewer.setLayerHighlight(null));
    label.addEventListener("dblclick", (e) => {
      e.preventDefault();
      toggleSolo(layer.name);
    });

    item.appendChild(label);
    layerList.appendChild(item);
    layerRows.set(layer.name, { item, checkbox });
  }
}

viewer.on("loaded", () => {
  soloLayer = null;
  hoveredLayer = null;
  rebuildLayerPanel();
  const { entityCount, segmentCount, unsupported } = viewer.stats;
  const skipped = Object.entries(unsupported)
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
  setStatus(
    `${currentName} — ${entityCount} entities, ${segmentCount} segments` +
      (skipped ? ` (skipped: ${skipped})` : ""),
  );
});

async function openSource(source: File | string, name: string): Promise<void> {
  currentName = name;
  setStatus(`Loading ${name}…`);
  try {
    if (typeof source === "string") await viewer.loadUrl(source);
    else await viewer.load(source);
  } catch (error) {
    setStatus(`Failed to load ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

$<HTMLButtonElement>("#open").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void openSource(file, file.name);
  fileInput.value = "";
});

$<HTMLButtonElement>("#load-sample").addEventListener("click", () => {
  void openSource("/sample.dxf", "sample.dxf");
});

$<HTMLButtonElement>("#toggle-layers").addEventListener("click", () => {
  panel.classList.toggle("open");
});

/* Hovering geometry on the canvas highlights its layer in the list. */
let pickQueued = false;
viewerEl.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || e.buttons !== 0) return;
  if (pickQueued) return;
  pickQueued = true;
  const { clientX, clientY } = e;
  requestAnimationFrame(() => {
    pickQueued = false;
    const rect = viewerEl.getBoundingClientRect();
    updateHoveredRow(viewer.pickLayer(clientX - rect.left, clientY - rect.top));
  });
});
viewerEl.addEventListener("pointerleave", () => updateHoveredRow(null));

/* Drag & drop */
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    dragDepth += 1;
    dropOverlay.hidden = false;
  }
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (file) void openSource(file, file.name);
});

void openSource("/sample.dxf", "sample.dxf");

/* Test hook: lets e2e tests observe viewer state. */
declare global {
  interface Window {
    __observo?: DxfViewer;
  }
}
window.__observo = viewer;
