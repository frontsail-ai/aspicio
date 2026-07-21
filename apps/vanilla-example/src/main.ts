/**
 * Minimal hand-rolled integration on the raw @aspicio/core API — no
 * ready-made components: create a viewer, load a URL, and build a custom
 * layer list + fit button from the public surface. Doubles as the browser
 * test harness for the core-direct consumption path.
 */
import { DxfViewer } from "@aspicio/core";

declare global {
  interface Window {
    /** The live viewer instance, exposed for the browser console (and tests). */
    __viewer?: DxfViewer;
  }
}

const stage = document.getElementById("stage");
const layersHost = document.getElementById("layers");
const statsHost = document.getElementById("stats");
if (!stage || !layersHost || !statsHost) throw new Error("missing page structure");

const viewer = new DxfViewer(stage, { background: 0x101318 });
window.__viewer = viewer;

function renderLayerList(): void {
  if (!layersHost) return;
  layersHost.textContent = "";
  for (const layer of viewer.getLayers()) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = layer.visible !== false;
    checkbox.addEventListener("change", () => {
      viewer.setLayerVisible(layer.name, checkbox.checked);
    });
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    const rgb = layer.effectiveColors?.[0] ?? layer.color;
    swatch.style.background = `#${rgb.toString(16).padStart(6, "0")}`;
    const name = document.createElement("span");
    name.textContent = layer.name;
    label.append(checkbox, swatch, name);
    layersHost.append(label);
  }
}

viewer.on("loaded", () => {
  renderLayerList();
  if (statsHost) statsHost.textContent = `${viewer.stats.entityCount} ENT`;
});

document.getElementById("fit")?.addEventListener("click", () => viewer.fitView());

viewer.loadUrl("/sample.dxf").catch((error: unknown) => {
  if (statsHost) statsHost.textContent = `load failed: ${String(error)}`;
});
