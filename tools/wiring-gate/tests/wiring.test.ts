/**
 * The workspace-wiring gate.
 *
 * INV-11's bundle gate proves what a *published* consumer bundles. It resolves
 * through node_modules with no aliases, so it says nothing about the imports
 * that only ever work because a tsconfig path or a vite alias rewrote them.
 * That axis has now cost us five incidents: four alias traps during the format
 * seam (a missing subpath entry silently resolving to
 * `.../core/src/index.ts/pdf`), and one shared module imported across
 * workspaces through a subpath its own package never exported —
 * `require.resolve` said MODULE_NOT_FOUND while every in-repo build succeeded.
 *
 * Two assertions, one gate, because they are the same failure: wiring that
 * works here and nowhere else.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { expect, test } from "vite-plus/test";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** Workspace roots that hold first-party source. */
const AREAS = ["packages", "apps", "tools"];

const SKIP_DIRS = new Set(["node_modules", "dist", "vercel-dist", "fixtures", ".git", "e2e"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|svelte|vue|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

interface Manifest {
  name?: string;
  exports?: Record<string, unknown> | string;
  private?: boolean;
  repository?: { url?: string; directory?: string };
}

/** Every first-party package manifest, by package name. */
function manifests(): Map<string, { dir: string; manifest: Manifest }> {
  const found = new Map<string, { dir: string; manifest: Manifest }>();
  for (const area of AREAS) {
    const areaDir = join(REPO, area);
    for (const entry of readdirSync(areaDir)) {
      const dir = join(areaDir, entry);
      if (!statSync(dir).isDirectory()) continue;
      let manifest: Manifest;
      try {
        manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
      } catch {
        continue;
      }
      if (manifest.name) found.set(manifest.name, { dir, manifest });
    }
  }
  return found;
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*["'](@aspicio\/[^"']+)["']/g;

/**
 * Every `@aspicio/*` import in first-party source must name a subpath the
 * target package's own `exports` map sanctions.
 *
 * A tsconfig path and a vite alias make an unexported subpath work in-repo and
 * nowhere else. Worse, they make it work *inconsistently*: `apps/api`'s Vercel
 * config deliberately carries no aliases, so a deploy resolves the same
 * specifier by a different route than `vp test` does. The exports map is the
 * one declaration every route agrees on, so it is the one this gate reads.
 */
test("every cross-workspace import is sanctioned by the target's exports map", () => {
  const packages = manifests();
  const violations: string[] = [];

  for (const area of AREAS) {
    for (const file of sourceFiles(join(REPO, area))) {
      const text = readFileSync(file, "utf8");
      for (const [, spec] of text.matchAll(IMPORT_RE)) {
        // "@aspicio/core/dxf" → name "@aspicio/core", subpath "./dxf"
        const parts = spec.split("/");
        const name = parts.slice(0, 2).join("/");
        const subpath = parts.length > 2 ? `./${parts.slice(2).join("/")}` : ".";
        const target = packages.get(name);
        if (!target) continue; // an external package that merely shares the scope

        const exportsMap = target.manifest.exports;
        const sanctioned =
          typeof exportsMap === "string"
            ? subpath === "."
            : exportsMap != null && Object.hasOwn(exportsMap, subpath);

        if (!sanctioned) {
          violations.push(`${relative(REPO, file)} imports ${spec} — ${name} does not export it`);
        }
      }
    }
  }

  expect(violations, violations.join("\n")).toEqual([]);
});

/**
 * The shared agent-tool table imports nothing but zod.
 *
 * Both MCP surfaces read it, and one of them is a deployed HTTP service. The
 * table is a table of strings; if it ever reaches for the renderer, the
 * filesystem, or the stdio plumbing, it drags that into every consumer's
 * graph. This is the claim a PR body of mine asserted in prose and could not
 * back — a comment saying "deliberately free of runtime imports" does not stay
 * true on its own.
 */
test("the shared agent-tool table imports nothing but zod", () => {
  const dir = join(REPO, "packages/agent-tools/src");
  const allowed = new Set(["zod"]);
  const seen: string[] = [];

  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, "utf8");
    for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      if (!allowed.has(spec)) seen.push(`${relative(REPO, file)} imports ${spec}`);
    }
  }

  expect(seen, seen.join("\n")).toEqual([]);
});

/**
 * The table's package declares no dependency that could pull a binary in.
 *
 * The import check above is per-file; this one is the manifest's promise. A
 * deployed service takes this package, so its dependency list is the ceiling
 * on what that service installs.
 */
test("the shared agent-tool table declares only zod as a dependency", () => {
  const manifest = JSON.parse(
    readFileSync(join(REPO, "packages/agent-tools/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  expect(Object.keys(manifest.dependencies ?? {})).toEqual(["zod"]);
});

/**
 * Every published package names this repository, at its own directory.
 *
 * The publish workflow attests provenance, and npm rejects a tarball whose
 * `repository.url` does not match the repo the attestation names. v0.13.1
 * shipped five packages and then failed on `@aspicio/mcp`, whose manifest had
 * never carried a `repository` field — harmless for years under token
 * publishing, fatal mid-release once provenance arrived. npm's 422 is the
 * only other place this is checked, and it runs after the earlier packages
 * are already public.
 */
test("every published package declares this repository and its directory", () => {
  const missing: string[] = [];

  for (const { dir, manifest } of manifests().values()) {
    const path = relative(REPO, dir).split("\\").join("/");
    if (!path.startsWith("packages/") || manifest.private) continue;
    const repo = manifest.repository;
    if (
      repo?.url !== "git+https://github.com/frontsail-ai/aspicio.git" ||
      repo.directory !== path
    ) {
      missing.push(`${path}: repository is ${JSON.stringify(repo ?? null)}`);
    }
  }

  expect(missing, missing.join("\n")).toEqual([]);
});
