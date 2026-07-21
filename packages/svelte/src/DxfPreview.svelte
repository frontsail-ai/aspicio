<!--
  Chrome-less embeddable DXF viewer — a thin Svelte veneer over the
  framework-neutral <aspicio-preview> element from @aspicio/elements.
  `bind:this` exposes `viewer()` — the full DxfViewer for camera control,
  layer toggling, and hit-testing; pair with DxfLayerPanel for a
  ready-made layer list. Providing `onhoverlayer` enables canvas
  hover-picking (parity with the React and Vue bindings).
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
    /** Show the built-in Download control (SVG / PNG export). */
    showDownload = true,
    /** Keyboard shortcuts on the focused viewer: F fit, +/- zoom, R reset, A show all. */
    shortcuts = false,
    /** Force canvas hover-picking on/off; defaults to on when onhoverlayer is provided. */
    hoverPick = undefined,
    /** ({ layers, stats }) after each successful load. */
    onloaded = undefined,
    /** (error) when a load fails. */
    onloaderror = undefined,
    /** (viewer | null) when the viewer is created or the element disconnects. */
    onviewerchange = undefined,
    /** (layer | null) for the layer under the cursor; providing it enables picking. */
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
</script>

<aspicio-preview
  bind:this={el}
  {src}
  src-url={srcUrl}
  {options}
  no-download={!showDownload || undefined}
  {shortcuts}
  hover-pick={(hoverPick ?? onhoverlayer != null) || undefined}
  onloaded={(e) => onloaded?.(e.detail)}
  onload-error={(e) => onloaderror?.(e.detail.error)}
  onviewer-change={(e) => onviewerchange?.(e.detail.viewer)}
  onhover-layer={(e) => onhoverlayer?.(e.detail.layer)}
  {...rest}
></aspicio-preview>
