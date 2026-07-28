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
    // Resolve the workspace dependencies from source so tests don't require
    // a prior `vp run build` (CI runs tests first).
    // Subpaths first: a string alias matches prefixes and the first match
    // wins, so a bare entry would otherwise swallow "@aspicio/core/dxf".
    alias: {
      "@aspicio/core/dxf": fileURLToPath(new URL("../core/src/dxf.ts", import.meta.url)),
      "@aspicio/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@aspicio/elements/formats/dxf": fileURLToPath(
        new URL("../elements/src/formats/dxf.ts", import.meta.url),
      ),
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
