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
    // Resolve the workspace dependency from source so tests don't require
    // a prior `vp run build` of @aspicio/core (CI runs tests first).
    alias: {
      "@aspicio/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
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
