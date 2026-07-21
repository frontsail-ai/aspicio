import type { DxfSource, DxfViewer, DxfViewerOptions, LayerInfo, ViewerStats } from "@aspicio/core";
import "@aspicio/elements";
import type { AspicioPreview } from "@aspicio/elements";
import { defineComponent, getCurrentInstance, h, ref, toRaw } from "vue";
import type { PropType } from "vue";

/** Payload of the `loaded` emit. */
export interface LoadedInfo {
  layers: LayerInfo[];
  stats: ViewerStats;
}

/**
 * Chrome-less embeddable DXF viewer — a thin Vue veneer over the
 * framework-neutral `<aspicio-preview>` element from @aspicio/elements.
 * The exposed `viewer` (via template ref) is the full DxfViewer for
 * camera control, layer toggling, and hit-testing; pair with
 * DxfLayerPanel for a ready-made layer list.
 *
 * Emits: `loaded` ({layers, stats}), `load-error` (Error),
 * `viewer-change` (DxfViewer | null), `hover-layer` (string | null —
 * binding a listener enables canvas hover-picking).
 */
export const DxfPreview = defineComponent({
  name: "DxfPreview",
  props: {
    /** DXF data: text, File, Blob, or ArrayBuffer. The most recently set of src/srcUrl wins. */
    src: { type: [String, Object] as PropType<DxfSource | null>, default: null },
    /** URL to fetch a DXF from. The most recently set of src/srcUrl wins. */
    srcUrl: { type: String as PropType<string | null>, default: null },
    /** Viewer options, applied at creation (changing them recreates the viewer). */
    options: { type: Object as PropType<DxfViewerOptions | undefined>, default: undefined },
    /** Show the built-in Download control (SVG / PNG export). */
    showDownload: { type: Boolean, default: true },
    /** Keyboard shortcuts on the focused viewer: F fit, +/- zoom, R reset, A show all. */
    shortcuts: { type: Boolean, default: false },
    /** Force canvas hover-picking on/off; defaults to on when @hover-layer is bound. */
    hoverPick: { type: Boolean, default: undefined },
  },
  emits: {
    loaded: (_info: LoadedInfo) => true,
    "load-error": (_error: Error) => true,
    "viewer-change": (_viewer: DxfViewer | null) => true,
    "hover-layer": (_layer: string | null) => true,
  },
  setup(props, { emit, expose }) {
    const el = ref<AspicioPreview | null>(null);
    // Hover picking auto-enables when a hover-layer listener is bound
    // (parity with @aspicio/react's onHoverLayer behavior). Listener keys
    // arrive camelized from templates and hyphenated from h() callers.
    const vnodeProps = getCurrentInstance()?.vnode.props ?? {};
    const hoverBound = "onHover-layer" in vnodeProps || "onHoverLayer" in vnodeProps;

    expose({
      /** The live DxfViewer instance, or null before mount / after unmount. */
      get viewer(): DxfViewer | null {
        return el.value?.viewer ?? null;
      },
    });

    return () =>
      h("aspicio-preview", {
        ref: el,
        // toRaw: reactive wrappers must not reach the viewer — File/Blob
        // pass through Vue unwrapped, but plain objects arrive as proxies.
        src: props.src == null ? null : toRaw(props.src),
        srcUrl: props.srcUrl,
        options: props.options ? toRaw(props.options) : undefined,
        noDownload: !props.showDownload,
        shortcuts: props.shortcuts,
        hoverPick: props.hoverPick ?? hoverBound,
        onLoaded: (e: Event) => emit("loaded", (e as CustomEvent<LoadedInfo>).detail),
        "onLoad-error": (e: Event) =>
          emit("load-error", (e as CustomEvent<{ error: Error }>).detail.error),
        "onViewer-change": (e: Event) =>
          emit("viewer-change", (e as CustomEvent<{ viewer: DxfViewer | null }>).detail.viewer),
        "onHover-layer": (e: Event) =>
          emit("hover-layer", (e as CustomEvent<{ layer: string | null }>).detail.layer),
      });
  },
});
