import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      // Consume core from source for instant HMR during development.
      "@aspicio/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
  // Unit tests live in src/; e2e/*.spec.ts is Playwright, not vitest.
  test: { include: ["src/**/*.test.ts"] },
});
