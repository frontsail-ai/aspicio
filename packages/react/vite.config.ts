import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

/*
 * Vitest resolves packages with Node's export conditions, which hands us
 * @lit/react's SSR build — it intentionally skips the useLayoutEffect
 * that applies properties/events (NODE_MODE), so components would render
 * inert in tests. Point tests at the browser build instead.
 */
const litReactBrowser = createRequire(import.meta.url)
  .resolve("@lit/react")
  .replace("/node/", "/");

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
    // wins, so a bare entry would otherwise swallow "@aspicio/core/dxf".
    alias: {
      "@aspicio/core/dxf": fileURLToPath(new URL("../core/src/dxf.ts", import.meta.url)),
      "@aspicio/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@aspicio/elements/formats/dxf": fileURLToPath(
        new URL("../elements/src/formats/dxf.ts", import.meta.url),
      ),
      "@aspicio/elements": fileURLToPath(new URL("../elements/src/index.ts", import.meta.url)),
      "@lit/react": litReactBrowser,
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
