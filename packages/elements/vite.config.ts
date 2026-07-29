import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "./tsconfig.build.json",
    // One entry per format, so a page bundles only what it imports (INV-11).
    entry: ["src/index.ts", "src/formats/dxf.ts"],
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  test: {
    // Resolve the workspace dependency from source so tests don't require
    // a prior `vp run build` of @aspicio/core (CI runs tests first).
    // Subpaths first: a string alias matches prefixes and the first match
    // wins, so the bare entry would otherwise swallow "@aspicio/core/dxf".
    alias: [
      {
        find: "@aspicio/core/dxf",
        replacement: fileURLToPath(new URL("../core/src/dxf.ts", import.meta.url)),
      },
      {
        find: "@aspicio/core",
        replacement: fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      },
    ],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
