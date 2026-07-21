import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [svelte()],
  test: {
    // Resolve the workspace dependencies from source so tests don't require
    // a prior `vp run build` (CI runs tests first).
    alias: {
      "@aspicio/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@aspicio/elements": fileURLToPath(new URL("../elements/src/index.ts", import.meta.url)),
    },
  },
  // Vitest resolves with Node export conditions, which selects svelte's
  // server build (mount() unavailable in tests); force the client runtime.
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
