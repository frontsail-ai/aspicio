/**
 * @aspicio/react — React bindings for the Aspicio DXF viewer.
 *
 * <AspicioPreview> embeds the interactive canvas; <AspicioLayerPanel> is an
 * optional ready-made layer list. Compose them, or build your own chrome
 * on the DrawingViewer instance exposed via ref/onViewer. The components are
 * thin veneers over the framework-neutral @aspicio/elements web
 * components, so React, Vue, Svelte, and plain-HTML embeds all share one
 * implementation — and one look.
 */

export { AspicioEmbed } from "./AspicioEmbed.tsx";
export type { AspicioEmbedProps } from "./AspicioEmbed.tsx";
export { AspicioPreview } from "./AspicioPreview.tsx";
export type { AspicioPreviewProps } from "./AspicioPreview.tsx";
export { AspicioLayerPanel } from "./AspicioLayerPanel.tsx";
export type { AspicioLayerPanelProps } from "./AspicioLayerPanel.tsx";
export { aspicioTokens, aspicioCanvasBackground } from "./theme.ts";
export type { AspicioTheme } from "./theme.ts";
