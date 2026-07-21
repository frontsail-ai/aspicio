import type { DxfViewer, ViewerStats } from "@aspicio/core";
import { DxfEmbed } from "@aspicio/vue";
import type { LoadedInfo } from "@aspicio/vue";
import { createApp, defineComponent, h, ref } from "vue";

declare global {
  interface Window {
    /** The live viewer instance, exposed for the browser console (and tests). */
    __viewer?: DxfViewer | null;
  }
}

/**
 * Minimal real-world usage of the Vue bindings: <DxfEmbed> renders the
 * layer panel + interactive viewer from a URL, with keyboard shortcuts on.
 * Authored with h() render functions so the toolchain needs no SFC
 * compiler (SFC usage looks the same — see the @aspicio/vue README).
 * Doubles as the browser test harness for the embed.
 */
const App = defineComponent({
  setup() {
    const stats = ref<ViewerStats | null>(null);
    return () =>
      h(
        "div",
        {
          style: {
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            background: "#0f1115",
            color: "#e7e3da",
            fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
          },
        },
        [
          h(
            "header",
            {
              style: {
                display: "flex",
                alignItems: "baseline",
                gap: "14px",
                padding: "11px 16px",
                borderBottom: "1px solid #282c34",
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: "13px",
                letterSpacing: "0.12em",
              },
            },
            [
              h("span", "ASPICIO · VUE EMBED"),
              stats.value
                ? h("span", { style: { color: "#9aa0ab" } }, `${stats.value.entityCount} ENT`)
                : null,
              h(
                "span",
                { style: { color: "#6a707b", fontSize: "11px", letterSpacing: "0.04em" } },
                "click the viewer, then F fit · A show all · +/− zoom · R reset",
              ),
            ],
          ),
          h("main", { style: { flex: "1", minHeight: "0", padding: "16px" } }, [
            h(DxfEmbed, {
              srcUrl: "/sample.dxf",
              shortcuts: true,
              style: { height: "100%", borderRadius: "8px" },
              "onViewer-change": (viewer: DxfViewer | null) => {
                window.__viewer = viewer;
              },
              onLoaded: (info: LoadedInfo) => {
                stats.value = info.stats;
              },
            }),
          ]),
        ],
      );
  },
});

createApp(App).mount("#app");
