import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@aspicio/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@aspicio/widget/meta": fileURLToPath(new URL("../widget/src/meta.ts", import.meta.url)),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
