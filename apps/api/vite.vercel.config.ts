import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// Packages the API for Vercel (`vp build --config vite.vercel.config.ts`):
// one self-contained Node function bundle plus the project files Vercel
// reads. Native resvg stays external — its platform binary installs at
// deploy from vercel-dist/package.json. Unlike vite.config.ts, @aspicio/core
// resolves through node_modules to its built dist (deploys use dist, not
// source — build core and the widget first).
const out = (path: string) => fileURLToPath(new URL(`vercel-dist/${path}`, import.meta.url));

export default defineConfig({
  build: {
    ssr: fileURLToPath(new URL("src/vercel.ts", import.meta.url)),
    target: "node20",
    outDir: "vercel-dist/api",
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: "index.mjs" },
      external: ["@resvg/resvg-js"],
    },
  },
  ssr: { noExternal: true, external: ["@resvg/resvg-js"] },
  plugins: [
    {
      name: "vercel-project-files",
      closeBundle() {
        mkdirSync(out(""), { recursive: true });
        writeFileSync(
          out("package.json"),
          `${JSON.stringify(
            {
              name: "aspicio-api-vercel",
              private: true,
              type: "module",
              dependencies: { "@resvg/resvg-js": "^2.6.2" },
            },
            null,
            2,
          )}\n`,
        );
        writeFileSync(
          out("vercel.json"),
          `${JSON.stringify(
            {
              $schema: "https://openapi.vercel.sh/vercel.json",
              rewrites: [{ source: "/(.*)", destination: "/api/index" }],
            },
            null,
            2,
          )}\n`,
        );
      },
    },
  ],
});
