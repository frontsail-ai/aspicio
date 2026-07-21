import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Vue's esm-bundler build expects these compile-time flags; without them
  // every dev console shows a feature-flag warning.
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
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
