import type { DrawingParser } from "@aspicio/core";
import { dxfParser } from "@aspicio/core/dxf";
import { pdfParser } from "@aspicio/core/pdf";
import type { ToolFormat, ToolMeta } from "@aspicio/agent-tools";

/**
 * The HTTP path for each tool kind and format, declared once (AGT-16).
 *
 * The paths used to be written by hand wherever one was needed, and two of
 * those copies were wrong: the hosted render tools linked every format to the
 * DXF-only `/render`, so a PDF link answered 422, and the wrong-format hint
 * built `/${kind}-${format}`, inventing `/describe-dxf` and `/render-dxf`. The
 * router, the image link, both hints, the rate limiter, and the OpenAPI
 * document now read their paths here.
 *
 * `satisfies` makes the table total: a new format fails the type check until
 * it has a path for every kind. It cannot catch a wrong entry, such as
 * `pdf: "/render"` — `tests/endpoint-paths.test.ts` follows every path through
 * the router for that.
 */
export const ENDPOINTS = {
  describe: { dxf: "/describe", pdf: "/describe-pdf", doc: "/describe-doc" },
  render: { dxf: "/render", pdf: "/render-pdf", doc: "/render-doc" },
} as const satisfies Record<ToolMeta["kind"], Record<ToolFormat, `/${string}`>>;

export type Kind = ToolMeta["kind"];

/** Which parsers each format accepts: the typed endpoints and tools read one
 *  format, the agnostic ones detect it from the bytes. */
export const PARSERS: Record<ToolFormat, readonly DrawingParser[]> = {
  dxf: [dxfParser],
  pdf: [pdfParser],
  doc: [dxfParser, pdfParser],
};

/**
 * Each concrete parser with its format.
 *
 * Core types a parser's `format` as a plain string, so it cannot index the
 * tables above. Pairing them here keeps every lookup typed.
 */
const SNIFFABLE: readonly (readonly [Exclude<ToolFormat, "doc">, DrawingParser])[] = [
  ["dxf", dxfParser],
  ["pdf", pdfParser],
];

/** The format of a drawing that `parsers` refuse but another parser
 *  recognizes, so a wrong-format reply can name what would have worked. */
export function otherFormat(
  parsers: readonly DrawingParser[],
  bytes: Uint8Array,
): Exclude<ToolFormat, "doc"> | undefined {
  return SNIFFABLE.find(([, parser]) => !parsers.includes(parser) && parser.sniff(bytes))?.[0];
}

/** Which kind and format a request path serves, or undefined. */
export function routeOf(path: string): { kind: Kind; format: ToolFormat } | undefined {
  for (const [kind, paths] of Object.entries(ENDPOINTS) as [Kind, Record<ToolFormat, string>][])
    for (const [format, candidate] of Object.entries(paths) as [ToolFormat, string][])
      if (candidate === path) return { kind, format };
  return undefined;
}

/** Phrase rewrites per format, longest context first: "DXF file" must match
 *  before the bare "DXF", or the qualifier is left stranded. */
const PHRASES: Record<Exclude<ToolFormat, "dxf">, readonly (readonly [RegExp, string])[]> = {
  pdf: [
    [/\ba \.dxf file \(ASCII or binary DXF\)/g, "a .pdf file"],
    [/\bDXF file\b/g, "PDF file"],
    [/\ba DXF\b/g, "a PDF"],
    [/\bDXF\b/g, "PDF"],
  ],
  doc: [
    [
      /\ba \.dxf file \(ASCII or binary DXF\)/g,
      "a drawing file (DXF or PDF, detected from the bytes)",
    ],
    [/\bDXF file\b/g, "drawing file"],
    // "a DXF drawing" → "a drawing", not "a drawing drawing": the alternation
    // takes the first alternative that matches at a position, so every longer
    // context has to precede the shorter one it contains.
    [/\ba DXF drawing\b/g, "a drawing"],
    [/\bDXF drawing\b/g, "drawing"],
    [/\ba DXF\b/g, "a drawing"],
    [/\bparsed as DXF\b/g, "parsed as any supported format"],
    // Sentence-initial: the bare noun would read "drawing exceeds the 8 MB…".
    [/\bDXF exceeds\b/g, "The drawing exceeds"],
    [/\bDXF\b/g, "drawing"],
  ],
};

/**
 * Say `text`, written for the DXF endpoints, in the words of `format`'s.
 *
 * The OpenAPI document and the error replies both go through this, so what
 * the document promises and what the endpoint answers cannot disagree.
 *
 * Chained `.replace()` calls re-scan their own output: the `.dxf file` rule
 * emits "(DXF or PDF, detected from the bytes)", which the later bare-`DXF`
 * rule then rewrote *inside* that replacement, producing "a drawing file
 * (drawing (DXF or PDF, detected from the bytes) or PDF, detected from the
 * bytes)". One alternation, matched left-to-right with the longest context
 * first, cannot re-enter what it just wrote.
 */
export function phraseFor(format: ToolFormat, text: string): string {
  if (format === "dxf") return text;
  const phrases = PHRASES[format];
  const combined = new RegExp(phrases.map(([pattern]) => `(?:${pattern.source})`).join("|"), "g");
  return text.replace(combined, (match) => {
    for (const [pattern, replacement] of phrases)
      if (new RegExp(`^(?:${pattern.source})$`).test(match)) return replacement;
    return match;
  });
}
