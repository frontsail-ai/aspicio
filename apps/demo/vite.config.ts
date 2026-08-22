import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite-plus";

const SITE = "https://aspicio.frontsail.app";

/* The sitemap is generated rather than hand-written: its dates froze at
   2026-07-19/21 while every page kept changing, and Google uses <lastmod>
   only while it stays verifiably accurate against the page itself. Each
   entry now carries the date of the last commit that touched that page's
   own source. `sources` lists what Google counts as a significant update —
   main content, structured data, links — so viewer internals and styling
   are deliberately absent from the static pages' entries. */
const PAGES: { path: string; sources: string[] }[] = [
  // The landing page: head metadata and JSON-LD in index.html, the
  // empty-state copy in main.ts.
  { path: "/", sources: ["apps/demo/index.html", "apps/demo/src/main.ts"] },
  { path: "/docs/", sources: ["apps/demo/public/docs/index.html"] },
  { path: "/mcp/", sources: ["apps/demo/public/mcp/index.html"] },
  { path: "/privacy/", sources: ["apps/demo/public/privacy/index.html"] },
  { path: "/terms/", sources: ["apps/demo/public/terms/index.html"] },
];

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Commit date (YYYY-MM-DD) of the last change to `file`, or null. */
function lastCommitDate(file: string): string | null {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/* No date beats a wrong date: a shallow clone (or no git at all) ships the
   entry without <lastmod> instead of inventing one. The deploy workflow
   checks out full history, so production carries the real dates. */
function sitemapXml(): string {
  const entries = PAGES.map(({ path, sources }) => {
    const lastmod = sources
      .map(lastCommitDate)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1);
    return [
      "  <url>",
      `    <loc>${SITE}${path}</loc>`,
      ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
      "  </url>",
    ].join("\n");
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
}

/* Served in dev as well as emitted at build: the e2e suite runs against the
   dev server (e2e/playwright.config.ts), and its crawler test fetches
   /sitemap.xml there. */
function sitemap(): Plugin {
  return {
    name: "aspicio-sitemap",
    configureServer(server) {
      server.middlewares.use("/sitemap.xml", (_req, res) => {
        res.setHeader("Content-Type", "application/xml");
        res.end(sitemapXml());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml() });
    },
  };
}

export default defineConfig({
  plugins: [sitemap()],
  resolve: {
    alias: {
      // Consume core from source for instant HMR during development.
      // Subpaths first: a string alias matches prefixes, first match wins.
      "@aspicio/core/pdf": fileURLToPath(
        new URL("../../packages/core/src/pdf.ts", import.meta.url),
      ),
      "@aspicio/core/dxf": fileURLToPath(
        new URL("../../packages/core/src/dxf.ts", import.meta.url),
      ),
      "@aspicio/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
  // Unit tests live in src/; e2e/*.spec.ts is Playwright, not vitest.
  test: { include: ["src/**/*.test.ts"] },
});
