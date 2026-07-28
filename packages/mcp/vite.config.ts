import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      // Subpaths first: a string alias matches prefixes, first match wins.
      "@aspicio/core/dxf": fileURLToPath(new URL("../core/src/dxf.ts", import.meta.url)),
      "@aspicio/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
