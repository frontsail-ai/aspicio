/**
 * @aspicio/elements — framework-neutral web components for the Aspicio
 * DXF viewer.
 *
 * <aspicio-embed> is the one-tag integration; <aspicio-preview> and
 * <aspicio-layer-panel> are its composable halves. Importing this module
 * registers all three custom elements. Works in plain HTML, Vue, Svelte,
 * and (via @aspicio/react) React.
 */

import { AspicioEmbed } from "./aspicio-embed.ts";
import { AspicioLayerPanel } from "./aspicio-layer-panel.ts";
import { AspicioPreview } from "./aspicio-preview.ts";

export { AspicioEmbed } from "./aspicio-embed.ts";
export type { PanelSide } from "./aspicio-embed.ts";
export { AspicioLayerPanel } from "./aspicio-layer-panel.ts";
export { AspicioPreview } from "./aspicio-preview.ts";
export type { LoadedDetail } from "./aspicio-preview.ts";
export { aspicioTokens } from "./theme.ts";
export type { DxfTheme } from "./theme.ts";

// Guarded registration: safe under repeated imports (two bundles on one
// page) and under Node's SSR shim, which provides a customElements stub.
function define(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}

define("aspicio-preview", AspicioPreview);
define("aspicio-layer-panel", AspicioLayerPanel);
define("aspicio-embed", AspicioEmbed);

declare global {
  interface HTMLElementTagNameMap {
    "aspicio-embed": AspicioEmbed;
    "aspicio-preview": AspicioPreview;
    "aspicio-layer-panel": AspicioLayerPanel;
  }
}
