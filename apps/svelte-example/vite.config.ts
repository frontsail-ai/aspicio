import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      // Consume the workspace packages from source for instant HMR.
      // Subpaths first: a string alias matches prefixes, first match wins.
      "@aspicio/core/dxf": fileURLToPath(
        new URL("../../packages/core/src/dxf.ts", import.meta.url),
      ),
      "@aspicio/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@aspicio/elements/formats/dxf": fileURLToPath(
        new URL("../../packages/elements/src/formats/dxf.ts", import.meta.url),
      ),
      "@aspicio/elements": fileURLToPath(
        new URL("../../packages/elements/src/index.ts", import.meta.url),
      ),
      "@aspicio/svelte/formats/dxf": fileURLToPath(
        new URL("../../packages/svelte/src/formats/dxf.js", import.meta.url),
      ),
      "@aspicio/svelte": fileURLToPath(
        new URL("../../packages/svelte/src/index.js", import.meta.url),
      ),
    },
  },
});
