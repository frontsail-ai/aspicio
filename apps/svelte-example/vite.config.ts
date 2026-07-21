import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      // Consume the workspace packages from source for instant HMR.
      "@aspicio/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@aspicio/elements": fileURLToPath(
        new URL("../../packages/elements/src/index.ts", import.meta.url),
      ),
      "@aspicio/svelte": fileURLToPath(
        new URL("../../packages/svelte/src/index.js", import.meta.url),
      ),
    },
  },
});
