import { expect, test } from "vite-plus/test";
import { parseDxf } from "../src/parse/parse.ts";
import { niceLength, unitLabel } from "../src/units.ts";

test("unitLabel maps $INSUNITS codes to short labels", () => {
  expect(unitLabel(4)).toBe("mm");
  expect(unitLabel(1)).toBe("in");
  expect(unitLabel(6)).toBe("m");
  expect(unitLabel(0)).toBe(""); // unitless
  expect(unitLabel(undefined)).toBe("");
  expect(unitLabel(999)).toBe(""); // unknown code
});

test("niceLength picks the largest 1/2/5 × 10ⁿ not exceeding max", () => {
  expect(niceLength(90)).toBe(50);
  expect(niceLength(30)).toBe(20);
  expect(niceLength(15)).toBe(10);
  expect(niceLength(7)).toBe(5);
  expect(niceLength(4)).toBe(2);
  expect(niceLength(1.5)).toBe(1);
  expect(niceLength(250)).toBe(200);
  expect(niceLength(600)).toBe(500);
  expect(niceLength(0)).toBe(0);
  expect(niceLength(-3)).toBe(0);
});

test("parseDxf reads $INSUNITS from the header into document.units", () => {
  const doc = parseDxf(
    [
      "0",
      "SECTION",
      "2",
      "HEADER",
      "9",
      "$INSUNITS",
      "70",
      "4",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n"),
  );
  expect(doc.units).toBe("mm");
});

test("a drawing without $INSUNITS is unitless", () => {
  const doc = parseDxf(["0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF"].join("\n"));
  expect(doc.units).toBe("");
});
