import type { DrawingSource, DrawingViewer, DrawingViewerOptions } from "@aspicio/core";
import "@aspicio/elements";
import type {
  AspicioEmbed as AspicioEmbedElement,
  AspicioTheme,
  AspicioThemeMode,
  PanelSide,
} from "@aspicio/elements";
import { defineComponent, h, ref, toRaw } from "vue";
import type { PropType } from "vue";
import type { LoadedInfo } from "./AspicioPreview.ts";

/**
 * Batteries-included embed: layer list + interactive preview in one
 * component — a thin Vue veneer over the framework-neutral
 * `<aspicio-embed>` element from @aspicio/elements, styled like the
 * Aspicio demo app (blueprint grid, dark panel) unless theme="none".
 * Pass the DXF as `src` (text, File, Blob, ArrayBuffer) or `srcUrl`;
 * everything else is optional.
 *
 *   <AspicioEmbed src-url="/drawing.dxf" style="height: 480px" @loaded="onLoaded" />
 *
 * The exposed `viewer` (via template ref) and the `viewer-change` emit
 * expose the full DrawingViewer for camera control; use AspicioPreview +
 * AspicioLayerPanel directly when you need a custom layout.
 */
export const AspicioEmbed = defineComponent({
  name: "AspicioEmbed",
  props: {
    /** DXF data: text, File, Blob, or ArrayBuffer. The most recently set of src/srcUrl wins. */
    src: { type: [String, Object] as PropType<DrawingSource | null>, default: null },
    /** URL to fetch a DXF from. The most recently set of src/srcUrl wins. */
    srcUrl: { type: String as PropType<string | null>, default: null },
    /** Viewer options, applied at creation (changing them recreates the viewer). */
    options: { type: Object as PropType<DrawingViewerOptions | undefined>, default: undefined },
    /** Where the layer list sits. */
    panel: { type: String as PropType<PanelSide>, default: "left" },
    /** Visual theme. Defaults to the Aspicio demo look. */
    theme: { type: String as PropType<AspicioTheme>, default: "aspicio" },
    /** Which palette the theme uses. Defaults to dark (VUE-10). */
    themeMode: { type: String as PropType<AspicioThemeMode>, default: "dark" },
    /** Inline styles applied to the inner layer panel (CSSOM values, e.g. "300px"). */
    panelStyle: {
      type: Object as PropType<Partial<CSSStyleDeclaration> | undefined>,
      default: undefined,
    },
    /** Show the built-in Download control (SVG / PNG export). */
    showDownload: { type: Boolean, default: true },
    /** Keyboard shortcuts on the focused viewer: F fit, +/- zoom, R reset, A show all. */
    shortcuts: { type: Boolean, default: false },
  },
  emits: {
    loaded: (_info: LoadedInfo) => true,
    "load-error": (_error: Error) => true,
    "viewer-change": (_viewer: DrawingViewer | null) => true,
    "hover-layer": (_layer: string | null) => true,
  },
  setup(props, { emit, expose }) {
    const el = ref<AspicioEmbedElement | null>(null);

    expose({
      /** The live DrawingViewer instance, or null before mount / after unmount. */
      get viewer(): DrawingViewer | null {
        return el.value?.viewer ?? null;
      },
    });

    return () =>
      h("aspicio-embed", {
        ref: el,
        src: props.src == null ? null : toRaw(props.src),
        srcUrl: props.srcUrl,
        options: props.options ? toRaw(props.options) : undefined,
        panel: props.panel,
        theme: props.theme,
        "theme-mode": props.themeMode,
        panelStyle: props.panelStyle ? toRaw(props.panelStyle) : undefined,
        noDownload: !props.showDownload,
        shortcuts: props.shortcuts,
        onLoaded: (e: Event) => emit("loaded", (e as CustomEvent<LoadedInfo>).detail),
        "onLoad-error": (e: Event) =>
          emit("load-error", (e as CustomEvent<{ error: Error }>).detail.error),
        "onViewer-change": (e: Event) =>
          emit("viewer-change", (e as CustomEvent<{ viewer: DrawingViewer | null }>).detail.viewer),
        "onHover-layer": (e: Event) =>
          emit("hover-layer", (e as CustomEvent<{ layer: string | null }>).detail.layer),
      });
  },
});
