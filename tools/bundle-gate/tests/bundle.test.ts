import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import type { Rollup } from "vite";
import { expect, test } from "vite-plus/test";

/**
 * INV-11, mechanized: bundle a fixture the way a real consumer would — through
 * `node_modules`, `exports` maps, and `sideEffects` — then read the output.
 *
 * The probe is the binary-DXF sentinel from `packages/core/src/parse/binary.ts`.
 * It is a string that DXF parsing cannot work without, which is what makes its
 * absence meaningful; the `*-dxf` fixtures are the canary that keeps the probe
 * honest if that string ever moves.
 */
const DXF_MARKER = "AutoCAD Binary DXF";

/**
 * The PDF probe: a message its strict gate cannot work without. Same reasoning
 * as the DXF marker — a string the parser must carry, so its absence means the
 * code is genuinely gone rather than merely renamed.
 */
const PDF_MARKER = "Encrypted PDFs are not supported";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}.ts`, import.meta.url));

/**
 * How the repo's own apps resolve the workspace packages: aliased to source
 * for instant HMR, subpaths first (a string alias matches prefixes and the
 * first match wins).
 *
 * This is a second, independent resolution path, and it reads a different
 * half of each `sideEffects` field — `./src/formats/*` rather than
 * `./dist/formats/*`. A package that covers only the published layout drops
 * its side-effect-only format module in every in-repo app, which is exactly
 * how four example apps once shipped a viewer with no parser.
 */
const SOURCE_ALIAS = {
  "@aspicio/core/dxf": pkgSrc("core/src/dxf.ts"),
  "@aspicio/core/pdf": pkgSrc("core/src/pdf.ts"),
  "@aspicio/core": pkgSrc("core/src/index.ts"),
  "@aspicio/elements/formats/dxf": pkgSrc("elements/src/formats/dxf.ts"),
  "@aspicio/elements/formats/pdf": pkgSrc("elements/src/formats/pdf.ts"),
  "@aspicio/elements": pkgSrc("elements/src/index.ts"),
  "@aspicio/react/formats/dxf": pkgSrc("react/src/formats/dxf.ts"),
  "@aspicio/react/formats/pdf": pkgSrc("react/src/formats/pdf.ts"),
  "@aspicio/vue/formats/dxf": pkgSrc("vue/src/formats/dxf.ts"),
  "@aspicio/vue/formats/pdf": pkgSrc("vue/src/formats/pdf.ts"),
  "@aspicio/svelte/formats/dxf": pkgSrc("svelte/src/formats/dxf.js"),
  "@aspicio/svelte/formats/pdf": pkgSrc("svelte/src/formats/pdf.js"),
};

function pkgSrc(rel: string): string {
  return fileURLToPath(new URL(`../../../packages/${rel}`, import.meta.url));
}

async function bundle(name: string, alias?: Record<string, string>): Promise<string> {
  const result = (await build({
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    configFile: false,
    ...(alias ? { resolve: { alias } } : {}),
    build: {
      write: false,
      minify: false,
      lib: { entry: fixture(name), formats: ["es"], fileName: name },
    },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  const outputs = Array.isArray(result) ? result : [result];
  return outputs
    .flatMap((o) => o.output)
    .filter((chunk): chunk is Rollup.OutputChunk => chunk.type === "chunk")
    .map((chunk) => chunk.code)
    .join("\n");
}

const require = createRequire(import.meta.url);

/**
 * Concatenate a published entry and everything it statically imports from its
 * own package.
 *
 * A consumer bundle is the wrong instrument for one half of INV-11: a leaked
 * `export { dxfParser }` on a root entry tree-shakes away in a fixture that
 * never reads it, so the bundle stays clean while the rule is broken. The
 * shipped entry's own import graph does not lie — a leak shows up as a static
 * import of the chunk holding the parser.
 */
function entryGraph(specifier: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    parts.push(code);
    // `\(?` catches `import("…")`: a lazily-loaded parser is still a parser
    // on the entry, and it evades the bundled half entirely — an unused
    // dynamic import tree-shakes away with the function that holds it.
    for (const match of code.matchAll(/(?:from|import)\s*\(?\s*"((?:\.|@aspicio\/)[^"]*)"/g)) {
      const spec = match[1];
      if (!spec) continue;
      // Workspace siblings count: a leak in core reaches every package that
      // re-exports it. Anything else (three, lit, react) is out of scope.
      visit(spec.startsWith(".") ? resolve(dirname(file), spec) : require.resolve(spec));
    }
  };
  visit(require.resolve(specifier));
  return parts.join("\n");
}

// 60s: each case runs a real Vite build of a package graph that includes three.
const TIMEOUT = 60_000;

test.each([
  "@aspicio/core",
  "@aspicio/elements",
  "@aspicio/react",
  "@aspicio/vue",
  "@aspicio/svelte",
])("the published %s root entry reaches no format code", (pkg) => {
  const graph = entryGraph(pkg);
  expect(graph).not.toContain(DXF_MARKER);
  expect(graph).not.toContain(PDF_MARKER);
});

test("the published format entries do reach their own format", () => {
  expect(entryGraph("@aspicio/core/dxf")).toContain(DXF_MARKER);
  expect(entryGraph("@aspicio/elements/formats/dxf")).toContain(DXF_MARKER);
  expect(entryGraph("@aspicio/core/pdf")).toContain(PDF_MARKER);
  expect(entryGraph("@aspicio/elements/formats/pdf")).toContain(PDF_MARKER);
});

// The point of INV-11: one format's entry must not drag in another's.
test("a format entry reaches no other format's code", () => {
  expect(entryGraph("@aspicio/core/dxf")).not.toContain(PDF_MARKER);
  expect(entryGraph("@aspicio/core/pdf")).not.toContain(DXF_MARKER);
  expect(entryGraph("@aspicio/elements/formats/dxf")).not.toContain(PDF_MARKER);
  expect(entryGraph("@aspicio/elements/formats/pdf")).not.toContain(DXF_MARKER);
});

test(
  "the core root entry carries no format, the /dxf entry does",
  async () => {
    expect(await bundle("core-bare")).not.toContain(DXF_MARKER);
    expect(await bundle("core-dxf")).toContain(DXF_MARKER);
  },
  TIMEOUT,
);

test(
  "importing the components implies no format; the format entry adds it",
  async () => {
    const bare = await bundle("elements-bare");
    expect(bare).not.toContain(DXF_MARKER);
    expect(bare).not.toContain(PDF_MARKER);
    expect(await bundle("elements-dxf")).toContain(DXF_MARKER);
  },
  TIMEOUT,
);

// The reverse direction, which is the whole reason the seam exists: a DXF-only
// app must not ship the PDF parser, and a PDF-only app must not ship the DXF
// one.
test(
  "a single-format bundle carries only that format",
  async () => {
    const dxfOnly = await bundle("core-dxf");
    const pdfOnly = await bundle("core-pdf");
    expect(dxfOnly).toContain(DXF_MARKER);
    expect(dxfOnly).not.toContain(PDF_MARKER);
    expect(pdfOnly).toContain(PDF_MARKER);
    expect(pdfOnly).not.toContain(DXF_MARKER);
  },
  TIMEOUT,
);

test(
  "the components carry only the format that was imported",
  async () => {
    const pdf = await bundle("elements-pdf");
    expect(pdf).toContain(PDF_MARKER);
    expect(pdf).not.toContain(DXF_MARKER);
  },
  TIMEOUT,
);

// The veneers each ship their own package.json: a stale `sideEffects: false`
// would let a bundler drop their side-effect-only re-export, and this is the
// only place that failure surfaces.
test.each(["react", "vue", "svelte"])(
  "the @aspicio/%s format entries survive bundling, each alone",
  async (veneer) => {
    const dxf = await bundle(`${veneer}-dxf`);
    expect(dxf).toContain(DXF_MARKER);
    expect(dxf).not.toContain(PDF_MARKER);
    const pdf = await bundle(`${veneer}-pdf`);
    expect(pdf).toContain(PDF_MARKER);
    expect(pdf).not.toContain(DXF_MARKER);
  },
  TIMEOUT,
);

// Both halves of `sideEffects` matter, because the repo consumes these
// packages two ways. The published layout is covered above; this is the
// source-aliased path every example app and the demo actually use.
test.each(["elements", "react", "vue", "svelte"])(
  "the %s format entries survive bundling from source too",
  async (pkg) => {
    expect(await bundle(`${pkg}-dxf`, SOURCE_ALIAS)).toContain(DXF_MARKER);
    expect(await bundle(`${pkg}-pdf`, SOURCE_ALIAS)).toContain(PDF_MARKER);
  },
  TIMEOUT,
);
