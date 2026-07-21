/**
 * @aspicio/svelte — Svelte 5 bindings for the Aspicio DXF viewer.
 *
 * <DxfPreview> embeds the interactive canvas; <DxfLayerPanel> is an
 * optional ready-made layer list. Compose them, or build your own chrome
 * on the DxfViewer instance exposed via bind:this / onviewerchange. The
 * components are thin veneers over the framework-neutral
 * @aspicio/elements web components, so Svelte, React, Vue, and
 * plain-HTML embeds all share one implementation — and one look.
 *
 * Ships as raw .svelte source (the `svelte` export condition); the
 * consumer's bundler compiles it.
 */

export { default as DxfEmbed } from "./DxfEmbed.svelte";
export { default as DxfLayerPanel } from "./DxfLayerPanel.svelte";
export { default as DxfPreview } from "./DxfPreview.svelte";
export { aspicioTokens } from "@aspicio/elements";
