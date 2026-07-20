import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite-plus";

/**
 * The MCP Apps resource is one self-contained text blob served over the
 * protocol, so wrap the single bundled chunk into dist/widget.html.
 */
function emitWidgetHtml(): Plugin {
  return {
    name: "aspicio:widget-html",
    generateBundle(_options, bundle) {
      const chunk = bundle["widget.js"];
      if (!chunk || chunk.type !== "chunk") throw new Error("expected a single widget.js chunk");
      // A literal "</script" inside the bundle would end the inline tag early.
      const js = chunk.code.replaceAll("</script", "<\\/script");
      this.emitFile({
        type: "asset",
        fileName: "widget.html",
        source: `<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>Aspicio viewer</title></head>\n<body>\n<script type="module">\n${js}\n</script>\n</body>\n</html>\n`,
      });
      delete bundle["widget.js"];
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      // Consume core from source, same as every other workspace.
      "@aspicio/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: fileURLToPath(new URL("src/main.ts", import.meta.url)),
      output: { entryFileNames: "widget.js", codeSplitting: false },
    },
  },
  plugins: [emitWidgetHtml()],
  test: { include: ["tests/**/*.test.ts"] },
});
