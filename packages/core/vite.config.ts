import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // One entry per format keeps DXF code out of a bundle that never asks
    // for it (INV-11); `exports: true` writes the subpaths into package.json.
    entry: ["src/index.ts", "src/dxf.ts", "src/pdf.ts"],
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
