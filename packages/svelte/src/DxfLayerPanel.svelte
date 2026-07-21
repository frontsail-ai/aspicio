<!--
  Ready-made layer list for an embedded viewer — a thin Svelte veneer over
  the framework-neutral <aspicio-layer-panel> element from
  @aspicio/elements. Matches the Aspicio demo app: header with layer
  count, visibility checkboxes, effective-color swatches, entity counts,
  hover-to-highlight, double-click-to-solo (with a banner), canvas-hover
  reverse-highlight, and a gesture-hints footer. Pass theme="none" for a
  minimal list; style internals via the element's ::part() hooks and
  --aspicio-* custom properties.
-->
<script>
  import "@aspicio/elements";

  let {
    /** The viewer to control — from DxfPreview's viewer() or onviewerchange. */
    viewer = null,
    /** Visual theme. Defaults to the Aspicio demo look; "none" renders a minimal list. */
    theme = "aspicio",
    /** Layer hovered on the canvas; its row is reverse-highlighted. */
    reverseHighlightLayer = null,
    /** Show the gesture-hints footer (themed mode only). */
    hints = true,
    /** Extra attributes (class, style, …) forwarded to the element. */
    ...rest
  } = $props();
</script>

<aspicio-layer-panel
  {viewer}
  {theme}
  reverse-highlight-layer={reverseHighlightLayer}
  no-hints={!hints || undefined}
  {...rest}
></aspicio-layer-panel>
