import { expect, test } from "vite-plus/test";
import { FONT_CAP_HEIGHT, glyph } from "../src/text/font.ts";
import { decodeTextSpecials, layoutText, stripMText } from "../src/text/layout.ts";
import type { DxfDocument, Entity } from "../src/model/types.ts";
import { parseDxf } from "../src/parse/parse.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

/* ---------- font ---------- */

test("decodes a known glyph ('I' is a single vertical stroke)", () => {
  const g = glyph("I".charCodeAt(0));
  expect(g.strokes).toHaveLength(1);
  expect(g.strokes[0]).toHaveLength(2);
  expect(FONT_CAP_HEIGHT).toBe(21);
});

test("space has advance but no strokes", () => {
  const g = glyph(" ".charCodeAt(0));
  expect(g.strokes).toHaveLength(0);
  expect(g.advance).toBeGreaterThan(0);
});

test("unmapped code falls back to the space glyph", () => {
  expect(glyph(9).strokes).toHaveLength(0); // tab
});

/* ---------- layout ---------- */

function bbox(polys: { x: number; y: number }[][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of polys)
    for (const p of s) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  return { minX, minY, maxX, maxY };
}

test("layout places the baseline at 0 and cap top at the height", () => {
  const b = bbox(layoutText("AH", { height: 10 }));
  expect(b.minY).toBeCloseTo(0, 1); // baseline
  expect(b.maxY).toBeCloseTo(10, 1); // cap height
  expect(b.minX).toBeGreaterThanOrEqual(0);
});

test("right/center alignment shifts the text left of the insertion point", () => {
  const left = bbox(layoutText("HELLO", { height: 5, hAlign: "left" }));
  const right = bbox(layoutText("HELLO", { height: 5, hAlign: "right" }));
  const center = bbox(layoutText("HELLO", { height: 5, hAlign: "center" }));
  // Each alignment shifts the run further left; right ends at the insertion.
  expect(center.minX).toBeLessThan(left.minX);
  expect(right.minX).toBeLessThan(center.minX);
  expect(Math.abs(right.maxX)).toBeLessThan(1); // right edge ~ insertion point
  expect(left.minX).toBeGreaterThan(-1); // left edge ~ insertion point
});

test("multi-line text stacks downward", () => {
  const single = bbox(layoutText("A", { height: 10 }));
  const multi = bbox(layoutText("A\nB", { height: 10 }));
  expect(multi.minY).toBeLessThan(single.minY); // second line is below the baseline
});

test("vAlign top puts the whole block below the insertion point", () => {
  const b = bbox(layoutText("A", { height: 10, vAlign: "top" }));
  expect(b.maxY).toBeCloseTo(0, 1); // top at insertion
  expect(b.minY).toBeCloseTo(-10, 1);
});

/* ---------- MTEXT code stripping ---------- */

test("stripMText collapses formatting to plain text", () => {
  expect(stripMText("\\pxqc;\\fArial|b0;Hello\\PWorld")).toBe("Hello\nWorld");
  expect(stripMText("\\A1;half \\S1/2;")).toBe("half 1/2");
  expect(stripMText("a\\~b")).toBe("a b");
  expect(stripMText("{\\C1;red} text")).toBe("red text");
  expect(stripMText("path\\\\to")).toBe("path\\to");
});

test("stripMText decodes \\U+XXXX before directive stripping can eat it", () => {
  expect(stripMText("45\\U+00B0")).toBe("45°");
  // Regression: a later semicolon used to make the directive pass swallow
  // everything from "\U" to the ";".
  expect(stripMText("45\\U+00B0C; done")).toBe("45°C; done");
});

/* ---------- TEXT control codes (PARSE-9) ---------- */

test("decodeTextSpecials substitutes %%d %%p %%c case-insensitively", () => {
  expect(decodeTextSpecials("45%%d")).toBe("45°");
  expect(decodeTextSpecials("%%P0.05")).toBe("±0.05");
  expect(decodeTextSpecials("%%C30 %%c20")).toBe("Ø30 Ø20");
});

test("decodeTextSpecials strips underline/overline/strike toggles", () => {
  expect(decodeTextSpecials("%%uDINING ROOM")).toBe("DINING ROOM");
  expect(decodeTextSpecials("%%Ostruck%%O and %%kgone%%k")).toBe("struck and gone");
});

test("decodeTextSpecials handles %%%, %%nnn, and leaves unknown codes literal", () => {
  expect(decodeTextSpecials("100%%%")).toBe("100%");
  expect(decodeTextSpecials("%%065BC")).toBe("ABC");
  expect(decodeTextSpecials("%%z stays")).toBe("%%z stays");
  expect(decodeTextSpecials("trailing %%")).toBe("trailing %%");
});

test("decodeTextSpecials unescapes \\U+XXXX and whitespace caret codes only", () => {
  expect(decodeTextSpecials("temp \\U+00B1 5")).toBe("temp ± 5");
  expect(decodeTextSpecials("a^Ib")).toBe("a\tb");
  expect(decodeTextSpecials("caret^ up")).toBe("caret^up");
  expect(decodeTextSpecials("x^2 + y^2")).toBe("x^2 + y^2"); // math stays intact
});

test("the %%-code symbols render real strokes, not the space fallback", () => {
  for (const ch of ["°", "±", "Ø"]) {
    expect(layoutText(ch, { height: 10 }).length).toBeGreaterThan(0);
  }
});

/* ---------- through the pipeline ---------- */

function textDoc(entities: Entity[]): DxfDocument {
  return {
    layers: new Map([
      ["0", { name: "0", color: 0xffffff, visible: true, frozen: false, entityCount: 0 }],
    ]),
    entities,
    blocks: new Map(),
    lineTypes: new Map(),
    unsupported: {},
  };
}

test("TEXT renders stroke polylines at its position", () => {
  const tess = tessellate(
    textDoc([
      {
        type: "TEXT",
        layer: "0",
        color: null,
        position: { x: 100, y: 50 },
        text: "A",
        height: 10,
        rotation: 0,
        widthFactor: 1,
        hAlign: "left",
        vAlign: "baseline",
      } as Entity,
    ]),
  );
  expect(tess.segmentCount).toBeGreaterThan(0);
  // 'A' baseline at y=50, cap top near y=60.
  expect(tess.bounds?.minY).toBeCloseTo(50, 0);
  expect(tess.bounds?.maxY).toBeCloseTo(60, 0);
  expect(tess.bounds?.minX).toBeGreaterThanOrEqual(99);
});

test("parse converts TEXT and MTEXT into TextEntity", () => {
  const doc = parseDxf(
    [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "TEXT",
      "8",
      "0",
      "10",
      "1",
      "20",
      "2",
      "40",
      "2.5",
      "1",
      "Hi",
      "50",
      "90",
      "0",
      "MTEXT",
      "8",
      "0",
      "10",
      "0",
      "20",
      "0",
      "40",
      "3",
      "1",
      "A\\PB",
      "71",
      "1",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n"),
  );
  const [text, mtext] = doc.entities;
  expect(text).toMatchObject({ type: "TEXT", text: "Hi", height: 2.5 });
  if (text.type === "TEXT") expect(text.rotation).toBeCloseTo(Math.PI / 2);
  expect(mtext).toMatchObject({ type: "TEXT", text: "A\nB", vAlign: "top", hAlign: "left" });
});
