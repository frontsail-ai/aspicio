import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "./tsconfig.build.json",
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  test: {
    // Resolve the workspace dependencies from source so tests don't require
    // a prior `vp run build` (CI runs tests first).
    alias: {
      "@aspicio/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@aspicio/elements": fileURLToPath(new URL("../elements/src/index.ts", import.meta.url)),
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
