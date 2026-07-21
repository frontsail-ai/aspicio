import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      // Consume the workspace package from source for instant HMR.
      "@aspicio/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
});
