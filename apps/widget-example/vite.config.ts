import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import type { Plugin } from "vite-plus";

const widgetFile = fileURLToPath(new URL("../widget/dist/widget.html", import.meta.url));

/**
 * The widget ships as one self-contained widget.html (built by
 * apps/widget). Serve it at /widget.html in dev and emit it into dist on
 * build — the showcase iframes it. Requires `vp run -r build` (or a
 * widget build) to have run first.
 */
function widgetAsset(): Plugin {
  return {
    name: "aspicio-widget-asset",
    configureServer(server) {
      server.middlewares.use("/widget.html", (_req, res) => {
        if (!existsSync(widgetFile)) {
          res.statusCode = 503;
          res.end("apps/widget/dist/widget.html missing — run `vp run -r build` first");
          return;
        }
        res.setHeader("Content-Type", "text/html");
        res.end(readFileSync(widgetFile));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "widget.html", source: readFileSync(widgetFile) });
    },
  };
}

export default defineConfig({
  plugins: [widgetAsset()],
});
