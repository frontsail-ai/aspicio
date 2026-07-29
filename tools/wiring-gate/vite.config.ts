import { defineConfig } from "vite-plus";

export default defineConfig({
  // No `@aspicio/*` aliases: this gate reads source files as text and consults
  // package manifests. An alias would let it resolve an import the gate exists
  // to prove is unresolvable.
  test: { include: ["tests/**/*.test.ts"] },
});
