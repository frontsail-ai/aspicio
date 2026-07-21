/**
 * @aspicio/vue — Vue 3 bindings for the Aspicio DXF viewer.
 *
 * <DxfPreview> embeds the interactive canvas; <DxfLayerPanel> is an
 * optional ready-made layer list. Compose them, or build your own chrome
 * on the DxfViewer instance exposed via template ref / @viewer-change.
 * The components are thin veneers over the framework-neutral
 * @aspicio/elements web components, so Vue, React, Svelte, and
 * plain-HTML embeds all share one implementation — and one look.
 */

export { DxfEmbed } from "./DxfEmbed.ts";
export { DxfLayerPanel } from "./DxfLayerPanel.ts";
export { DxfPreview } from "./DxfPreview.ts";
export type { LoadedInfo } from "./DxfPreview.ts";
export { aspicioTokens } from "@aspicio/elements";
export type { DxfTheme, PanelSide } from "@aspicio/elements";
