import type { DxfViewer, LayerInfo, ViewerStats } from "@aspicio/core";
import { DxfEmbed } from "@aspicio/react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    /** The live viewer instance, exposed for the browser console (and tests). */
    __viewer?: DxfViewer | null;
  }
}

/**
 * Minimal real-world usage of the React bindings: <DxfEmbed> renders the
 * layer panel + interactive viewer from a URL, with keyboard shortcuts on.
 * Doubles as the browser test harness for the embed.
 */
function App(): React.JSX.Element {
  const [stats, setStats] = useState<ViewerStats | null>(null);
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0f1115",
        color: "#e7e3da",
        fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          padding: "11px 16px",
          borderBottom: "1px solid #282c34",
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 13,
          letterSpacing: "0.12em",
        }}
      >
        <span>ASPICIO · REACT EMBED</span>
        {stats ? <span style={{ color: "#9aa0ab" }}>{stats.entityCount} ENT</span> : null}
        <span style={{ color: "#6a707b", fontSize: 11, letterSpacing: "0.04em" }}>
          click the viewer, then F fit · A show all · +/− zoom · R reset
        </span>
      </header>
      <main style={{ flex: 1, minHeight: 0, padding: 16 }}>
        <DxfEmbed
          srcUrl="/sample.dxf"
          shortcuts
          style={{ height: "100%", borderRadius: 8 }}
          onViewer={(v) => {
            window.__viewer = v;
          }}
          onLoaded={(info: { layers: LayerInfo[]; stats: ViewerStats }) => setStats(info.stats)}
        />
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
