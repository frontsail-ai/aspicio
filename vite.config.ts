import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    // The bundle gate's fixtures are build inputs, not source: they resolve
    // `@aspicio/*` through node_modules and `exports`, which only exist after
    // a build — and `vp check` runs before builds. The gate bundles them with
    // Vite, so a broken specifier still fails, where it matters.
    ignorePatterns: ["tools/bundle-gate/fixtures/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
