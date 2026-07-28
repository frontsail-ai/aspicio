import { defineConfig } from "vite-plus";

export default defineConfig({
  // No `@aspicio/*` aliases on purpose: the gate must resolve the packages
  // through node_modules exactly as a consumer does, or it would prove
  // nothing about the published `exports` and `sideEffects` maps (INV-11).
  test: { include: ["tests/**/*.test.ts"] },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
