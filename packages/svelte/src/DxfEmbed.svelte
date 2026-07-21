<!--
  Batteries-included embed: layer list + interactive preview in one
  component — a thin Svelte veneer over the framework-neutral
  <aspicio-embed> element from @aspicio/elements, styled like the Aspicio
  demo app (blueprint grid, dark panel) unless theme="none". Pass the DXF
  as `src` (text, File, Blob, ArrayBuffer) or `srcUrl`; everything else
  is optional.

    <DxfEmbed srcUrl="/drawing.dxf" style="height: 480px" onloaded={...} />

  `bind:this` exposes `viewer()` — the full DxfViewer for camera control;
  use DxfPreview + DxfLayerPanel directly when you need a custom layout.
-->
<script>
  import "@aspicio/elements";

  let {
    /** DXF data: text, File, Blob, or ArrayBuffer. The most recently set of src/srcUrl wins. */
    src = null,
    /** URL to fetch a DXF from. The most recently set of src/srcUrl wins. */
    srcUrl = null,
    /** Viewer options, applied at creation (changing them recreates the viewer). */
    options = undefined,
    /** Where the layer list sits: "left" | "right" | "none". */
    panel = "left",
    /** Visual theme. Defaults to the Aspicio demo look. */
    theme = "aspicio",
    /** Inline styles applied to the inner layer panel (CSSOM values, e.g. "300px"). */
    panelStyle = undefined,
    /** Show the built-in Download control (SVG / PNG export). */
    showDownload = true,
    /** Keyboard shortcuts on the focused viewer: F fit, +/- zoom, R reset, A show all. */
    shortcuts = false,
    /** ({ layers, stats }) after each successful load. */
    onloaded = undefined,
    /** (error) when a load fails. */
    onloaderror = undefined,
    /** (viewer | null) when the viewer is created or the element disconnects. */
    onviewerchange = undefined,
    /** (layer | null) for the layer under the cursor. */
    onhoverlayer = undefined,
    /** Extra attributes (class, style, …) forwarded to the element. */
    ...rest
  } = $props();

  // Assigned by bind:this (compiler-generated; linter can't see it).
  let el = null;

  /** The live DxfViewer instance, or null before mount / after unmount. */
  export function viewer() {
    return el?.viewer ?? null;
  }

  // panelStyle is a property-only field on the element (rich object), and
  // Svelte lowercases template attribute names — assign it imperatively.
  $effect(() => {
    if (el) el.panelStyle = panelStyle;
  });
</script>

<aspicio-embed
  bind:this={el}
  {src}
  src-url={srcUrl}
  {options}
  {panel}
  {theme}
  no-download={!showDownload || undefined}
  {shortcuts}
  onloaded={(e) => onloaded?.(e.detail)}
  onload-error={(e) => onloaderror?.(e.detail.error)}
  onviewer-change={(e) => onviewerchange?.(e.detail.viewer)}
  onhover-layer={(e) => onhoverlayer?.(e.detail.layer)}
  {...rest}
></aspicio-embed>
