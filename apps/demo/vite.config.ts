import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      // Consume core from source for instant HMR during development.
      "@observo/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
});
