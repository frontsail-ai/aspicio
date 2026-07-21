/**
 * Minimal real-world usage of the web components: the embed itself lives
 * entirely in index.html as a plain tag — this module only registers the
 * elements and listens to their DOM events, exactly as a Vue or Svelte
 * host would. Doubles as the browser test harness for @aspicio/elements.
 */
import "@aspicio/elements";
import type { DxfViewer, LayerInfo, ViewerStats } from "@aspicio/core";

declare global {
  interface Window {
    /** The live viewer instance, exposed for the browser console (and tests). */
    __viewer?: DxfViewer | null;
  }
}

const embed = document.querySelector("aspicio-embed");
const stats = document.getElementById("stats");

embed?.addEventListener("viewer-change", (e) => {
  window.__viewer = (e as CustomEvent<{ viewer: DxfViewer | null }>).detail.viewer;
});

embed?.addEventListener("loaded", (e) => {
  const detail = (e as CustomEvent<{ layers: LayerInfo[]; stats: ViewerStats }>).detail;
  if (stats) stats.textContent = `${detail.stats.entityCount} ENT`;
});
