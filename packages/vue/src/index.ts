/**
 * @aspicio/vue — Vue 3 bindings for the Aspicio DXF viewer.
 *
 * <AspicioPreview> embeds the interactive canvas; <AspicioLayerPanel> is an
 * optional ready-made layer list. Compose them, or build your own chrome
 * on the DrawingViewer instance exposed via template ref / @viewer-change.
 * The components are thin veneers over the framework-neutral
 * @aspicio/elements web components, so Vue, React, Svelte, and
 * plain-HTML embeds all share one implementation — and one look.
 */

export { AspicioEmbed } from "./AspicioEmbed.ts";
export { AspicioLayerPanel } from "./AspicioLayerPanel.ts";
export { AspicioPreview } from "./AspicioPreview.ts";
export type { LoadedInfo } from "./AspicioPreview.ts";
export { aspicioTokens } from "@aspicio/elements";
export type { AspicioTheme, PanelSide } from "@aspicio/elements";
