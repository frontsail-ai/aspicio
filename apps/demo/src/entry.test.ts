/**
 * Entry-point resolution (DEMO-23).
 *
 * The property under test is that the three outcomes are *distinguishable*.
 * Before this module, a `src` in the query string produced the same result as
 * an empty hash — which is why it failed onto a blank screen with nothing to
 * correct (#193).
 */

import { describe, expect, it } from "vite-plus/test";
import { resolveEntry, withoutSrc } from "./entry.ts";

const SRC = "https://example.com/drawing.pdf";

describe("resolveEntry", () => {
  it("loads a hash link, as before", () => {
    const entry = resolveEntry(`#src=${encodeURIComponent(SRC)}`, "");
    expect(entry.kind).toBe("link");
    expect(entry.kind === "link" && entry.link.src).toBe(SRC);
  });

  it("offers a query src rather than loading it", () => {
    const entry = resolveEntry("", `?src=${encodeURIComponent(SRC)}`);
    expect(entry).toEqual({ kind: "offer", src: SRC });
  });

  it("prefers the hash when both carriers are present", () => {
    // The hash is the canonical share form and carries the view state too; a
    // query src alongside it is a fragment of some other link.
    const other = "https://example.com/other.dxf";
    const entry = resolveEntry(
      `#src=${encodeURIComponent(SRC)}`,
      `?src=${encodeURIComponent(other)}`,
    );
    expect(entry.kind).toBe("link");
    expect(entry.kind === "link" && entry.link.src).toBe(SRC);
  });

  it.each(["javascript:alert(1)", "data:text/plain,x", "file:///etc/passwd", "not a url", ""])(
    "refuses %s in the query",
    (value) => {
      // The same guard the hash path applies on decode (DEMO-18). An offer is
      // a button the visitor will click, so an unsafe value must never reach
      // it — declining to offer is the whole protection.
      expect(resolveEntry("", `?src=${encodeURIComponent(value)}`).kind).toBe("none");
    },
  );

  it("reports nothing for an empty or unrelated location", () => {
    expect(resolveEntry("", "").kind).toBe("none");
    expect(resolveEntry("", "?utm_source=x").kind).toBe("none");
    expect(resolveEntry("#", "").kind).toBe("none");
  });
});

describe("withoutSrc", () => {
  it("drops src and keeps everything else", () => {
    // The consent-banner override and any campaign tag are not this feature's
    // business; only `src` is answered here.
    expect(withoutSrc("?src=https%3A%2F%2Fx.com%2Fa.pdf&consent=1")).toBe("?consent=1");
    expect(withoutSrc("?src=https%3A%2F%2Fx.com%2Fa.pdf")).toBe("");
    expect(withoutSrc("")).toBe("");
    expect(withoutSrc("?a=1&b=2")).toBe("?a=1&b=2");
  });
});
