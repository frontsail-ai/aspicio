import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      // Consume the workspace packages from source for instant HMR.
      "@aspicio/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@aspicio/elements": fileURLToPath(
        new URL("../../packages/elements/src/index.ts", import.meta.url),
      ),
      "@aspicio/vue": fileURLToPath(new URL("../../packages/vue/src/index.ts", import.meta.url)),
    },
  },
});
