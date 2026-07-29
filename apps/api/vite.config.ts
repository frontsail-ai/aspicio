import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      // Subpaths first: a string alias matches prefixes, first match wins.
      "@aspicio/core/pdf": fileURLToPath(
        new URL("../../packages/core/src/pdf.ts", import.meta.url),
      ),
      "@aspicio/core/dxf": fileURLToPath(
        new URL("../../packages/core/src/dxf.ts", import.meta.url),
      ),
      "@aspicio/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@aspicio/widget/meta": fileURLToPath(new URL("../widget/src/meta.ts", import.meta.url)),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
