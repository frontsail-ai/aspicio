import type { DxfViewer } from "@aspicio/core";
import "@aspicio/elements";
import type { DxfTheme } from "@aspicio/elements";
import { defineComponent, h, toRaw } from "vue";
import type { PropType } from "vue";

/**
 * Ready-made layer list for an embedded viewer — a thin Vue veneer over
 * the framework-neutral `<aspicio-layer-panel>` element from
 * @aspicio/elements. Matches the Aspicio demo app: header with layer
 * count, visibility checkboxes, effective-color swatches, entity counts,
 * hover-to-highlight, double-click-to-solo (with a banner), canvas-hover
 * reverse-highlight, and a gesture-hints footer. Pass theme="none" for a
 * minimal list; style internals via the element's `::part()` hooks and
 * `--aspicio-*` custom properties.
 */
export const DxfLayerPanel = defineComponent({
  name: "DxfLayerPanel",
  props: {
    /** The viewer to control — from DxfPreview's exposed viewer or viewer-change emit. */
    viewer: { type: Object as PropType<DxfViewer | null>, default: null },
    /** Visual theme. Defaults to the Aspicio demo look; "none" renders a minimal list. */
    theme: { type: String as PropType<DxfTheme>, default: "aspicio" },
    /** Layer hovered on the canvas; its row is reverse-highlighted. */
    reverseHighlightLayer: { type: String as PropType<string | null>, default: null },
    /** Show the gesture-hints footer (themed mode only). */
    hints: { type: Boolean, default: true },
  },
  setup(props) {
    return () =>
      h("aspicio-layer-panel", {
        // toRaw: a viewer held in a ref() arrives as a reactive proxy, and
        // proxied method calls break the viewer's internals.
        viewer: props.viewer ? toRaw(props.viewer) : null,
        theme: props.theme,
        reverseHighlightLayer: props.reverseHighlightLayer,
        noHints: !props.hints,
      });
  },
});
