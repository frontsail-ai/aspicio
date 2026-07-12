/**
 * @aspicio/react — React bindings for the Aspicio DXF viewer.
 *
 * <DxfPreview> embeds the interactive canvas; <DxfLayerPanel> is an
 * optional ready-made layer list. Compose them, or build your own chrome
 * on the DxfViewer instance exposed via ref/onViewer.
 */

export { DxfEmbed } from "./DxfEmbed.tsx";
export type { DxfEmbedProps } from "./DxfEmbed.tsx";
export { DxfPreview } from "./DxfPreview.tsx";
export type { DxfPreviewProps } from "./DxfPreview.tsx";
export { DxfLayerPanel } from "./DxfLayerPanel.tsx";
export type { DxfLayerPanelProps } from "./DxfLayerPanel.tsx";
export { aspicioTokens, aspicioCanvasBackground } from "./theme.ts";
export type { DxfTheme } from "./theme.ts";
