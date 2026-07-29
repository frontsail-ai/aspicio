import { defineConfig } from "vite-plus";

export default defineConfig({
  // No `@aspicio/*` aliases on purpose: the gate must resolve the packages
  // through node_modules exactly as a consumer does, or it would prove
  // nothing about the published `exports` and `sideEffects` maps (INV-11).
  test: { include: ["tests/**/*.test.ts"] },
  // Fixtures are excluded from linting at the root config — they are build
  // inputs that only resolve after a build. See README.
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
