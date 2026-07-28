/**
 * @aspicio/svelte — Svelte 5 bindings for the Aspicio DXF viewer.
 *
 * <AspicioPreview> embeds the interactive canvas; <AspicioLayerPanel> is an
 * optional ready-made layer list. Compose them, or build your own chrome
 * on the DrawingViewer instance exposed via bind:this / onviewerchange. The
 * components are thin veneers over the framework-neutral
 * @aspicio/elements web components, so Svelte, React, Vue, and
 * plain-HTML embeds all share one implementation — and one look.
 *
 * Ships as raw .svelte source (the `svelte` export condition); the
 * consumer's bundler compiles it.
 */

export { default as AspicioEmbed } from "./AspicioEmbed.svelte";
export { default as AspicioLayerPanel } from "./AspicioLayerPanel.svelte";
export { default as AspicioPreview } from "./AspicioPreview.svelte";
export { aspicioTokens } from "@aspicio/elements";
