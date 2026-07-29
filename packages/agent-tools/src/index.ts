/**
 * @aspicio/agent-tools — the tool table both MCP surfaces implement (AGT-16).
 *
 * The stdio server and the hosted one have genuinely different plumbing: one
 * reads local files, the other is URL-only inside a serverless function. What
 * they must not differ on is *which* tools exist and what each one claims to
 * do — AGT-16's whole assertion is that both offer the same six.
 *
 * So the metadata lives here and the handlers stay per-server. Two transcribed
 * tables would drift for the same reason four hand-copied OpenAPI operations
 * would.
 *
 * This package is neutral ground on purpose. It first lived inside
 * `@aspicio/mcp`, which made a deployed HTTP service depend on the stdio CLI —
 * and on the native rasterizer binary in that CLI's dependency list — to read
 * a table of strings. A contract both surfaces implement belongs in neither of
 * them.
 *
 * `private: true` with `exports` pointing at source, like `@aspicio/widget`:
 * in-repo consumers resolve it legally rather than through an alias no
 * published `exports` map sanctions. `@aspicio/mcp` takes it as a
 * devDependency so tsdown bundles it into `dist/index.mjs` and the published
 * CLI never names an unpublished package.
 *
 * Imports nothing but zod — asserted, not asserted-by-comment, in
 * tools/wiring-gate.
 */

import { z } from "zod";

/** The JSON facts a describe returns, as an MCP output schema (AGT-1). */
export const DRAWING_SUMMARY_SHAPE = {
  format: z.string().describe('Which format was read ("dxf", "pdf")'),
  units: z.string().describe('Drawing-unit label (e.g. "mm"), "" when unitless'),
  bounds: z
    .object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() })
    .nullable()
    .describe("World-space extents, null for an empty drawing"),
  size: z
    .object({ width: z.number(), height: z.number() })
    .nullable()
    .describe("Bounding-box size in drawing units, null when empty"),
  entityCount: z.number().int(),
  segmentCount: z.number().int(),
  layers: z.array(
    z.object({
      name: z.string(),
      entityCount: z.number().int(),
      visible: z.boolean(),
      color: z.string().describe("The color actually drawn (dominant), as #rrggbb"),
    }),
  ),
  entityTypes: z.record(z.string(), z.number()).describe("Top-level entities per DXF type"),
  unsupported: z.record(z.string(), z.number()).describe("Per-kind counts of what was skipped"),
  texts: z.array(z.string()).describe("Unique TEXT/MTEXT strings, blocks included"),
};

/** Behaviour hints every tool declares explicitly (AGT-6). */
export const READ_ONLY_HINTS = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
} as const;

/** Which formats a tool accepts. */
export type ToolFormat = "dxf" | "pdf" | "doc";

export interface ToolMeta {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly format: ToolFormat;
  /** Describes return data; renders return an image and declare no schema. */
  readonly kind: "describe" | "render";
}

/**
 * The six tools, in the order they are registered.
 *
 * Descriptions carry the when-to-use guidance, because a client with no
 * bundled skill has only these to go on (AGT-6).
 */
export const TOOLS: readonly ToolMeta[] = [
  {
    name: "describe_dxf",
    title: "Describe a DXF drawing",
    format: "dxf",
    kind: "describe",
    description:
      "Return a structured JSON summary of a DXF drawing — units, bounding box, layers (with the color actually drawn), per-type entity counts, and any skipped/unsupported types. Use this to answer structural questions (what layers exist, how many parts, what size, is it to scale) without rendering an image. For a PDF use describe_pdf; if you do not know the format, use describe_doc.",
  },
  {
    name: "render_dxf",
    title: "Render a DXF to an image",
    format: "dxf",
    kind: "render",
    description:
      "Render a DXF drawing to a PNG image you can look at. Use this to answer visual questions (what does it look like, where is a feature, does it look right) — it returns an image, not text. For structural facts, prefer describe_dxf. For a PDF use render_pdf; if you do not know the format, use render_doc.",
  },
  {
    name: "describe_pdf",
    title: "Describe a PDF drawing",
    format: "pdf",
    kind: "describe",
    description:
      "Return a structured JSON summary of a PDF drawing — units (points), bounding box, layers, per-type entity counts, the text it contains, and what was skipped (images, shadings, transparency). Use this for structural questions about a PDF without rendering it. For a DXF use describe_dxf; if you do not know the format, use describe_doc.",
  },
  {
    name: "render_pdf",
    title: "Render a PDF to an image",
    format: "pdf",
    kind: "render",
    description:
      "Render a PDF drawing's vector content to a PNG you can look at. Images, shadings, and transparency are not drawn — they are reported by describe_pdf — so this shows line work and text, not a page facsimile. For a DXF use render_dxf; if you do not know the format, use render_doc.",
  },
  {
    name: "describe_doc",
    title: "Describe a drawing of any supported format",
    format: "doc",
    kind: "describe",
    description:
      "Return a structured JSON summary of a drawing in any supported format (DXF or PDF), detected from its bytes rather than its name. Use this when you do not know which format you have; the reply names the format that was read.",
  },
  {
    name: "render_doc",
    title: "Render a drawing of any supported format",
    format: "doc",
    kind: "render",
    description:
      "Render a drawing in any supported format (DXF or PDF) to a PNG you can look at, detected from its bytes rather than its name. Use this when you do not know which format you have.",
  },
];

/** The width argument every render tool accepts. */
export const widthSchema = z
  .number()
  .int()
  .min(64)
  .max(4000)
  .optional()
  .describe("PNG width in pixels (default 1200)");
