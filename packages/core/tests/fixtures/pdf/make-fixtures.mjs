/**
 * Generates the tiny PDFs the object-layer tests read (PDF-2).
 *
 * Run from this directory: `node make-fixtures.mjs`
 *
 * Each fixture isolates one structural feature so a failing test names the
 * feature rather than "a PDF broke". They are generated rather than
 * hand-written because the byte offsets in a cross-reference table have to be
 * exact, and hand-maintaining them across edits is a trap.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const enc = (s) => Buffer.from(s, "latin1");

/** Assemble a classic-xref PDF from object bodies, computing real offsets. */
function classic(objects, trailerExtra = "") {
  const chunks = [enc("%PDF-1.7\n")];
  let offset = chunks[0].length;
  const offsets = [];
  for (const [num, body] of objects) {
    const bytes = Buffer.concat([
      enc(`${num} 0 obj\n`),
      Buffer.isBuffer(body) ? body : enc(body),
      enc("\nendobj\n"),
    ]);
    offsets.push([num, offset]);
    chunks.push(bytes);
    offset += bytes.length;
  }
  const xrefAt = offset;
  const size = Math.max(...objects.map(([n]) => n)) + 1;
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    const found = offsets.find(([num]) => num === n);
    table += found ? `${String(found[1]).padStart(10, "0")} 00000 n \n` : `0000000000 65535 f \n`;
  }
  table += `trailer\n<< /Size ${size} /Root 1 0 R ${trailerExtra} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(enc(table));
  return Buffer.concat(chunks);
}

const catalog = [1, "<< /Type /Catalog /Pages 2 0 R >>"];

/* Baseline JPEGs for the DCTDecode fixtures, committed as data so fixture
 * generation stays dependency-free. Provenance: a 16×16 PNG of four solid
 * quadrants (TL red, TR green, BL blue, BR yellow) converted once with
 * macOS sips 16.x — `sips -s format jpeg -s formatOptions 90` for the RGB
 * one; `sips -s format jpeg --matchTo "Generic CMYK Profile"` plus APP0-13
 * segment stripping for the Adobe CMYK one (SOF0, APP14 transform 0). */
const JPEG_RGB_QUAD = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAA" +
    "A6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMu" +
    "MAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIR" +
    "AQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAAB" +
    "fQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5" +
    "OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeo" +
    "qaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMB" +
    "AQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYS" +
    "QVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNU" +
    "VVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5" +
    "usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAQEBAQEBAgEBAgMCAgID" +
    "BAMDAwMEBQQEBAQEBQYFBQUFBQUGBgYGBgYGBgcHBwcHBwgICAgICQkJCQkJCQkJCf/bAEMBAQEB" +
    "AgICBAICBAkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJ" +
    "CQkJCf/dAAQAAf/aAAwDAQACEQMRAD8A/F+v6UK/g3r/AGKK/gH/AEhf6DP/ABKh/qh/wqf2p/an" +
    "17/lz9W9l9W+p/8AT3Ec/P8AWP7nLyfa5vd+o/aucSf8Txf2B7n9i/2L9Z6/XPbfXPq/lhfZ+z+q" +
    "/wDTzn9p9nl97//Z",
  "base64",
);
const JPEG_CMYK_QUAD = Buffer.from(
  "/9j/7gAOQWRvYmUAZAAAAAAA/8AAFAgAEAAQBAERAAIRAQMRAQQRAf/EAB8AAAEFAQEBAQEBAAAA" +
    "AAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQy" +
    "gZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm" +
    "Z2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS" +
    "09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYH" +
    "CAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1Lw" +
    "FWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5" +
    "eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj" +
    "5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgK" +
    "CgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgMDBAQEBwQEBxALCQsQEBAQEBAQEBAQ" +
    "EBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAv/aAA4EAQACEQMR" +
    "BBEAPwD9+K/ynP8AD8/30Pxbr/tUP9WDoP/Q/Hev5HP9/D/fw/tIr/q0P+T8D//Z",
  "base64",
);

const pagesNode = (kids) => [
  2,
  `<< /Type /Pages /Kids [${kids}] /Count ${kids.split("0 R").length - 1} >>`,
];

/* 1. The simplest readable file: classic xref, one page, one content stream. */
{
  const content = "1 0 0 RG\n10 20 m 30 40 l S\n";
  writeFileSync(
    "minimal.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>"],
      [
        4,
        Buffer.concat([
          enc(`<< /Length ${content.length} >>\nstream\n`),
          enc(content),
          enc("\nendstream"),
        ]),
      ],
    ]),
  );
}

/* 2. Flate-compressed content, and /Length as an indirect reference. */
{
  const content = "0 0 1 rg\n0 0 50 50 re f\n";
  const z = deflateSync(Buffer.from(content, "latin1"));
  writeFileSync(
    "flate-indirect-length.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>"],
      [
        4,
        Buffer.concat([
          enc("<< /Length 5 0 R /Filter /FlateDecode >>\nstream\n"),
          z,
          enc("\nendstream"),
        ]),
      ],
      [5, String(z.length)],
    ]),
  );
}

/* 3. /Contents as an array of parts — a token must not span the join. */
{
  // Split mid-number on purpose: naive concatenation yields "1010" not "10 10".
  const a = "10 ";
  const b = "10 m 20 20 l S\n";
  writeFileSync(
    "contents-array.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents [4 0 R 5 0 R] >>"],
      [4, Buffer.concat([enc(`<< /Length ${a.length} >>\nstream\n`), enc(a), enc("\nendstream")])],
      [5, Buffer.concat([enc(`<< /Length ${b.length} >>\nstream\n`), enc(b), enc("\nendstream")])],
    ]),
  );
}

/* 4. Inherited /Resources and /MediaBox from the pages node. */
{
  const content = "BT /F1 12 Tf 10 10 Td (hi) Tj ET\n";
  writeFileSync(
    "inherited-attrs.pdf",
    classic([
      catalog,
      [
        2,
        "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> >>",
      ],
      [3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"],
      [
        4,
        Buffer.concat([
          enc(`<< /Length ${content.length} >>\nstream\n`),
          enc(content),
          enc("\nendstream"),
        ]),
      ],
      [5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
    ]),
  );
}

/* 5. Cross-reference stream + object stream + PNG Up predictor. */
{
  const content = "0 0 0 RG\n5 5 m 95 95 l S\n";
  const contentStream = Buffer.concat([
    enc(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`),
    enc(content),
    enc("\nendstream\nendobj\n"),
  ]);

  // Objects 1, 2, 3 live inside an object stream (object 5).
  const inner = [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>"],
  ];
  let bodies = "";
  const pairs = [];
  for (const [num, body] of inner) {
    pairs.push(`${num} ${bodies.length}`);
    bodies += `${body}\n`;
  }
  const header = `${pairs.join(" ")}\n`;
  const objStmPayload = deflateSync(Buffer.from(header + bodies, "latin1"));

  const head = enc("%PDF-1.7\n");
  let offset = head.length;
  const contentAt = offset;
  offset += contentStream.length;
  const objStmAt = offset;
  const objStm = Buffer.concat([
    enc(
      `5 0 obj\n<< /Type /ObjStm /N ${inner.length} /First ${header.length} /Length ${objStmPayload.length} /Filter /FlateDecode >>\nstream\n`,
    ),
    objStmPayload,
    enc("\nendstream\nendobj\n"),
  ]);
  offset += objStm.length;
  const xrefAt = offset;

  // W [1 4 2]; rows for objects 0..6. Predictor 12 (PNG Up) over 7-byte rows.
  const rows = [];
  const push = (type, second, third) => {
    const row = Buffer.alloc(7);
    row[0] = type;
    row.writeUInt32BE(second, 1);
    row.writeUInt16BE(third, 5);
    rows.push(row);
  };
  push(0, 0, 65535); // free
  push(2, 5, 0); // obj 1 in objstm 5, index 0
  push(2, 5, 1); // obj 2
  push(2, 5, 2); // obj 3
  push(1, contentAt, 0); // obj 4 content stream
  push(1, objStmAt, 0); // obj 5 the object stream
  push(1, xrefAt, 0); // obj 6 the xref stream itself

  // Apply PNG Up encoding: each row stores its delta from the previous row.
  const predicted = [];
  let prev = Buffer.alloc(7);
  for (const row of rows) {
    const out = Buffer.alloc(8);
    out[0] = 2; // Up
    for (let i = 0; i < 7; i++) out[i + 1] = (row[i] - prev[i]) & 0xff;
    predicted.push(out);
    prev = row;
  }
  const xrefPayload = deflateSync(Buffer.concat(predicted));
  const xrefStream = Buffer.concat([
    enc(
      `6 0 obj\n<< /Type /XRef /Size 7 /W [1 4 2] /Root 1 0 R /Filter /FlateDecode ` +
        `/DecodeParms << /Predictor 12 /Columns 7 /Colors 1 /BitsPerComponent 8 >> ` +
        `/Length ${xrefPayload.length} >>\nstream\n`,
    ),
    xrefPayload,
    enc(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`),
  ]);

  writeFileSync("xref-stream-objstm.pdf", Buffer.concat([head, contentStream, objStm, xrefStream]));
}

/* 6. An incremental update: /Prev chain where the newer section wins. */
{
  const base = classic([
    catalog,
    pagesNode("3 0 R"),
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>"],
    [4, Buffer.concat([enc("<< /Length 12 >>\nstream\n"), enc("1 1 m 2 2 l"), enc("\nendstream")])],
  ]);
  const firstXrefAt = base.lastIndexOf(Buffer.from("xref\n0 "));
  const updated = "9 9 m 8 8 l S\n";
  const newObj = Buffer.concat([
    enc(`4 0 obj\n<< /Length ${updated.length} >>\nstream\n`),
    enc(updated),
    enc("\nendstream\nendobj\n"),
  ]);
  const newObjAt = base.length;
  const secondXrefAt = newObjAt + newObj.length;
  const tail = enc(
    `xref\n0 1\n0000000000 65535 f \n4 1\n${String(newObjAt).padStart(10, "0")} 00000 n \n` +
      `trailer\n<< /Size 5 /Root 1 0 R /Prev ${firstXrefAt} >>\nstartxref\n${secondXrefAt}\n%%EOF\n`,
  );
  writeFileSync("incremental-update.pdf", Buffer.concat([base, newObj, tail]));
}

/* 7. Encrypted (the strict gate's fatal case, PDF-1). */
{
  writeFileSync(
    "encrypted.pdf",
    classic(
      [
        catalog,
        pagesNode("3 0 R"),
        [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>"],
        [4, "<< /Filter /Standard /V 2 /R 3 /O <00> /U <00> /P -1 >>"],
      ],
      "/Encrypt 4 0 R",
    ),
  );
}

/* 8. Signed but not encrypted — must load (PDF-1: signature is not encryption). */
{
  writeFileSync(
    "signed-not-encrypted.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [
        3,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Annots [5 0 R] >>",
      ],
      [
        4,
        Buffer.concat([
          enc("<< /Length 14 >>\nstream\n"),
          enc("1 1 m 9 9 l S"),
          enc("\nendstream"),
        ]),
      ],
      [5, "<< /Type /Annot /Subtype /Widget /FT /Sig /V 6 0 R >>"],
      [6, "<< /Type /Sig /ByteRange [0 100 200 300] /Contents <30820> /Filter /Adobe.PPKLite >>"],
    ]),
  );
}

/* 9. A damaged cross-reference table that recovery must survive. */
{
  const good = classic([
    catalog,
    pagesNode("3 0 R"),
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>"],
    [
      4,
      Buffer.concat([enc("<< /Length 13 >>\nstream\n"), enc("3 3 m 7 7 l S"), enc("\nendstream")]),
    ],
  ]);
  // Point startxref at nonsense; the objects themselves are intact.
  const broken = Buffer.from(good)
    .toString("latin1")
    .replace(/startxref\n\d+/, "startxref\n999999");
  writeFileSync("broken-xref.pdf", Buffer.from(broken, "latin1"));
}

/* ---------- strict-gate fixtures (PDF-1) ---------- */

/** A page whose content draws text with the named font resource. */
function fontFixture(name, fontObj, { draws = true } = {}) {
  const content = draws
    ? "BT /F1 12 Tf 10 10 Td (hello) Tj ET\n"
    : "BT /F1 12 Tf ET\n10 10 m 20 20 l S\n"; // selects the font, shows no text
  writeFileSync(
    name,
    classic([
      catalog,
      pagesNode("3 0 R"),
      [
        3,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R " +
          "/Resources << /Font << /F1 5 0 R >> >> >>",
      ],
      [
        4,
        Buffer.concat([
          enc(`<< /Length ${content.length} >>\nstream\n`),
          enc(content),
          enc("\nendstream"),
        ]),
      ],
      ...fontObj,
    ]),
  );
}

/* 10. Text in a font the file does not carry — the gate's fatal case. */
fontFixture("font-not-embedded.pdf", [
  [5, "<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FontDescriptor 6 0 R >>"],
  [6, "<< /Type /FontDescriptor /FontName /Arial /Flags 32 >>"],
]);

/* 11. The same font, declared and selected but never drawn with — must load.
      This is what makes the gate a usage check rather than a resource audit. */
fontFixture(
  "font-not-embedded-unused.pdf",
  [
    [5, "<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FontDescriptor 6 0 R >>"],
    [6, "<< /Type /FontDescriptor /FontName /Arial /Flags 32 >>"],
  ],
  { draws: false },
);

/* 12. An embedded font program — must load. */
fontFixture("font-embedded.pdf", [
  [5, "<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Arial /FontDescriptor 6 0 R >>"],
  [6, "<< /Type /FontDescriptor /FontName /ABCDEF+Arial /Flags 32 /FontFile2 7 0 R >>"],
  [7, Buffer.concat([enc("<< /Length 4 >>\nstream\n"), enc("fake"), enc("\nendstream")])],
]);

/* 13. A Type 3 font: glyphs are drawing procedures, so they count as present
      (PDF-1). The Ghent X-4 suite uses these, so a false rejection here would
      reject the acceptance corpus. */
fontFixture("font-type3.pdf", [
  [
    5,
    "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 10 10] /FontMatrix [0.001 0 0 0.001 0 0] " +
      "/CharProcs << /h 7 0 R >> /Encoding << /Differences [104 /h] >> /FirstChar 104 " +
      "/LastChar 104 /Widths [500] >>",
  ],
  [6, "<< /Type /FontDescriptor /FontName /T3 /Flags 4 >>"],
  [7, Buffer.concat([enc("<< /Length 12 >>\nstream\n"), enc("0 0 5 5 re f"), enc("\nendstream")])],
]);

/* 14. A composite font whose program hangs off the descendant — must load. */
fontFixture("font-composite-embedded.pdf", [
  [
    5,
    "<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Noto /Encoding /Identity-H /DescendantFonts [6 0 R] >>",
  ],
  [6, "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+Noto /FontDescriptor 7 0 R >>"],
  [7, "<< /Type /FontDescriptor /FontName /ABCDEF+Noto /Flags 4 /FontFile2 8 0 R >>"],
  [8, Buffer.concat([enc("<< /Length 4 >>\nstream\n"), enc("fake"), enc("\nendstream")])],
]);

/* 15. A form XObject whose bytes live in another file — the gate's third case. */
{
  const content = "/X1 Do\n";
  writeFileSync(
    "external-content.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [
        3,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R " +
          "/Resources << /XObject << /X1 5 0 R >> >> >>",
      ],
      [
        4,
        Buffer.concat([
          enc(`<< /Length ${content.length} >>\nstream\n`),
          enc(content),
          enc("\nendstream"),
        ]),
      ],
      [
        5,
        Buffer.concat([
          enc(
            "<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /F (other.pdf) /Length 0 >>\nstream\n",
          ),
          enc("\nendstream"),
        ]),
      ],
    ]),
  );
}

/* 16. Text drawn inside a form, in a font the form does not carry — the gate
      has to follow forms, where most real content lives. */
{
  const page = "/X1 Do\n";
  const form = "BT /F1 12 Tf 1 1 Td (hi) Tj ET\n";
  writeFileSync(
    "form-font-not-embedded.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [
        3,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R " +
          "/Resources << /XObject << /X1 5 0 R >> >> >>",
      ],
      [
        4,
        Buffer.concat([
          enc(`<< /Length ${page.length} >>\nstream\n`),
          enc(page),
          enc("\nendstream"),
        ]),
      ],
      [
        5,
        Buffer.concat([
          enc(
            `<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] ` +
              `/Resources << /Font << /F1 6 0 R >> >> /Length ${form.length} >>\nstream\n`,
          ),
          enc(form),
          enc("\nendstream"),
        ]),
      ],
      [6, "<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FontDescriptor 7 0 R >>"],
      [7, "<< /Type /FontDescriptor /FontName /Arial /Flags 32 >>"],
    ]),
  );
}

/* ---------- gate gaps found by review probes ---------- */

/* 17. A form with no /Resources, drawing text with the *page's* font.
      Forms without their own resources fall back to the invoking context's. */
{
  const page = "/X1 Do\n";
  const form = "BT /F1 12 Tf 1 1 Td (hi) Tj ET\n";
  writeFileSync(
    "form-inherits-resources.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [
        3,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R " +
          "/Resources << /XObject << /X1 5 0 R >> /Font << /F1 6 0 R >> >> >>",
      ],
      [
        4,
        Buffer.concat([
          enc(`<< /Length ${page.length} >>\nstream\n`),
          enc(page),
          enc("\nendstream"),
        ]),
      ],
      [
        5,
        Buffer.concat([
          enc(
            `<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length ${form.length} >>\nstream\n`,
          ),
          enc(form),
          enc("\nendstream"),
        ]),
      ],
      [6, "<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FontDescriptor 7 0 R >>"],
      [7, "<< /Type /FontDescriptor /FontName /Arial /Flags 32 >>"],
    ]),
  );
}

/* 18. A form that inherits the *selected font*: Tf runs on the page, Tj runs
      inside the form. Forms inherit the graphics state of their caller. */
{
  const page = "BT /F1 12 Tf ET\n/X1 Do\n";
  const form = "BT 1 1 Td (hi) Tj ET\n";
  writeFileSync(
    "form-inherits-font.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [
        3,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R " +
          "/Resources << /XObject << /X1 5 0 R >> /Font << /F1 6 0 R >> >> >>",
      ],
      [
        4,
        Buffer.concat([
          enc(`<< /Length ${page.length} >>\nstream\n`),
          enc(page),
          enc("\nendstream"),
        ]),
      ],
      [
        5,
        Buffer.concat([
          enc(
            `<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length ${form.length} >>\nstream\n`,
          ),
          enc(form),
          enc("\nendstream"),
        ]),
      ],
      [6, "<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FontDescriptor 7 0 R >>"],
      [7, "<< /Type /FontDescriptor /FontName /Arial /Flags 32 >>"],
    ]),
  );
}

/* 19. A page whose *own* content stream lives in another file. */
{
  writeFileSync(
    "external-page-content.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>"],
      [4, Buffer.concat([enc("<< /F (elsewhere.pdf) /Length 0 >>\nstream\n"), enc("\nendstream")])],
    ]),
  );
}

/* 20. Three pages, so page→space mapping has something to map (PDF-5). */
{
  const pageContent = (n) => `${n} ${n} m ${n * 10} ${n * 10} l S\n`;
  const objs = [
    catalog,
    [2, "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 /MediaBox [0 0 300 200] >>"],
  ];
  let obj = 3;
  for (let i = 1; i <= 3; i++) {
    const content = pageContent(i);
    objs.push([obj, `<< /Type /Page /Parent 2 0 R /Contents ${obj + 1} 0 R >>`]);
    objs.push([
      obj + 1,
      Buffer.concat([
        enc(`<< /Length ${content.length} >>\nstream\n`),
        enc(content),
        enc("\nendstream"),
      ]),
    ]);
    obj += 2;
  }
  writeFileSync("three-pages.pdf", classic(objs));
}

/* 21. A file with no pages at all. */
writeFileSync("no-pages.pdf", classic([catalog, [2, "<< /Type /Pages /Kids [] /Count 0 >>"]]));

/* 22. A form whose Flate data is garbage — hostile input, not a real file.
      The page must still draw its own content and report the loss. */
{
  const page = "1 0 0 RG 5 5 m 95 95 l S\n/X1 Do\n";
  writeFileSync(
    "form-undecodable.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [
        3,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R " +
          "/Resources << /XObject << /X1 5 0 R >> >> >>",
      ],
      [
        4,
        Buffer.concat([
          enc(`<< /Length ${page.length} >>\nstream\n`),
          enc(page),
          enc("\nendstream"),
        ]),
      ],
      [
        5,
        Buffer.concat([
          enc(
            "<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Filter /FlateDecode /Length 8 >>\nstream\n",
          ),
          Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x01, 0x02, 0x03]),
          enc("\nendstream"),
        ]),
      ],
    ]),
  );
}

/* 23. Two pages: page 1 invokes a form with garbage Flate, page 2 is fine.
      A damaged page must cost that page, never the document. */
{
  const p1 = "1 0 0 RG 5 5 m 95 95 l S\n/X1 Do\n";
  const p2 = "0 0 1 RG 10 10 m 90 90 l S\n";
  writeFileSync(
    "bad-page-good-page.pdf",
    classic([
      catalog,
      [2, "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 /MediaBox [0 0 100 100] >>"],
      [
        3,
        "<< /Type /Page /Parent 2 0 R /Contents 4 0 R " +
          "/Resources << /XObject << /X1 5 0 R >> >> >>",
      ],
      [
        4,
        Buffer.concat([enc(`<< /Length ${p1.length} >>\nstream\n`), enc(p1), enc("\nendstream")]),
      ],
      [
        5,
        Buffer.concat([
          enc(
            "<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Filter /FlateDecode /Length 8 >>\nstream\n",
          ),
          Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x01, 0x02, 0x03]),
          enc("\nendstream"),
        ]),
      ],
      [6, "<< /Type /Page /Parent 2 0 R /Contents 7 0 R >>"],
      [
        7,
        Buffer.concat([enc(`<< /Length ${p2.length} >>\nstream\n`), enc(p2), enc("\nendstream")]),
      ],
    ]),
  );
}

/* 24. A page rotated a quarter turn — orientation lives on the page, not in
      the content, so ignoring it renders the drawing sideways. */
{
  const content = "0 0 m 100 0 l S\n";
  writeFileSync(
    "rotated-page.pdf",
    classic([
      catalog,
      pagesNode("3 0 R"),
      [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Rotate 90 /Contents 4 0 R >>"],
      [
        4,
        Buffer.concat([
          enc(`<< /Length ${content.length} >>\nstream\n`),
          enc(content),
          enc("\nendstream"),
        ]),
      ],
    ]),
  );
}

/* 25. Page 1's own /Contents is undecodable; page 2 is fine. The gate reads
      page content before the interpreter does, so this is a second path to
      the same "one page must not kill the document" guarantee. */
{
  const p2 = "0 0 1 RG 10 10 m 90 90 l S\n";
  writeFileSync(
    "bad-page-contents.pdf",
    classic([
      catalog,
      [2, "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /MediaBox [0 0 100 100] >>"],
      [3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"],
      [
        4,
        Buffer.concat([
          enc("<< /Filter /FlateDecode /Length 8 >>\nstream\n"),
          Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x01, 0x02, 0x03]),
          enc("\nendstream"),
        ]),
      ],
      [5, "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>"],
      [
        6,
        Buffer.concat([enc(`<< /Length ${p2.length} >>\nstream\n`), enc(p2), enc("\nendstream")]),
      ],
    ]),
  );
}

console.log("wrote gate-path fixtures");

// ---------------------------------------------------------------------------
// Optional content (PDF-7). Each isolates one decision from the corpus probe.
{
  const draw = "0 0 1 RG 10 10 m 90 90 l S\n";
  const build = (objects, ocProps) =>
    classic([[1, `<< /Type /Catalog /Pages 2 0 R /OCProperties ${ocProps} >>`], ...objects]);

  const page = () => [2, `<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 100 100] >>`];
  const pageObj = (propsEntries, extra = "") => [
    3,
    `<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Properties << ${propsEntries} >> ${extra} >> >>`,
  ];
  const stream = (num, text) => [
    num,
    Buffer.concat([enc(`<< /Length ${text.length} >>\nstream\n`), enc(text), enc("\nendstream")]),
  ];
  const ocg = (num, name) => [num, `<< /Type /OCG /Name (${name}) >>`];

  // 1. Two groups, one hidden by /OFF — the ordinary case.
  writeFileSync(
    "ocg-basic.pdf",
    build(
      [
        page(),
        pageObj("/L1 5 0 R /L2 6 0 R"),
        stream(4, `/OC /L1 BDC\n${draw}EMC\n/OC /L2 BDC\n${draw}EMC\n`),
        ocg(5, "Visible Layer"),
        ocg(6, "Hidden Layer"),
      ],
      "<< /OCGs [5 0 R 6 0 R] /D << /Order [5 0 R 6 0 R] /OFF [6 0 R] >> >>",
    ),
  );

  // 2. /BaseState /OFF: everything hidden except the /ON list. Reading only
  //    /OFF renders this document fully visible — silently. No corpus file
  //    has one, which is exactly why this fixture exists.
  writeFileSync(
    "ocg-basestate-off.pdf",
    build(
      [
        page(),
        pageObj("/L1 5 0 R /L2 6 0 R"),
        stream(4, `/OC /L1 BDC\n${draw}EMC\n/OC /L2 BDC\n${draw}EMC\n`),
        ocg(5, "Shown By ON"),
        ocg(6, "Hidden By Base"),
      ],
      "<< /OCGs [5 0 R 6 0 R] /D << /BaseState /OFF /ON [5 0 R] >> >>",
    ),
  );

  // 3. /Order names one of three groups. The other two must still appear.
  writeFileSync(
    "ocg-partial-order.pdf",
    build(
      [
        page(),
        pageObj("/L1 5 0 R /L2 6 0 R /L3 7 0 R"),
        stream(4, `/OC /L1 BDC\n${draw}EMC\n/OC /L2 BDC\n${draw}EMC\n/OC /L3 BDC\n${draw}EMC\n`),
        ocg(5, "First"),
        ocg(6, "Second"),
        ocg(7, "Ordered"),
      ],
      "<< /OCGs [5 0 R 6 0 R 7 0 R] /D << /Order [7 0 R] >> >>",
    ),
  );

  // 4. A membership dictionary over two groups — the fallback the corpus
  //    never triggers: first group wins, simplification counted.
  writeFileSync(
    "ocg-ocmd-multi.pdf",
    build(
      [
        page(),
        pageObj("/M1 8 0 R"),
        stream(4, `/OC /M1 BDC\n${draw}EMC\n`),
        ocg(5, "Alpha"),
        ocg(6, "Beta"),
        [8, "<< /Type /OCMD /OCGs [5 0 R 6 0 R] >>"],
      ],
      "<< /OCGs [5 0 R 6 0 R] /D << >> >>",
    ),
  );

  // 5. A visibility expression: not evaluated, content stays on Content.
  writeFileSync(
    "ocg-visibility-expression.pdf",
    build(
      [
        page(),
        pageObj("/M1 8 0 R"),
        stream(4, `/OC /M1 BDC\n${draw}EMC\n`),
        ocg(5, "A"),
        ocg(6, "B"),
        [8, "<< /Type /OCMD /VE [/Not [/And 5 0 R 6 0 R]] >>"],
      ],
      "<< /OCGs [5 0 R 6 0 R] /D << >> >>",
    ),
  );

  // 6. A group declared but referenced by nothing — a real layer with no
  //    entities, which isEmptyLayer collapses in every panel (PDF-7).
  writeFileSync(
    "ocg-unused-group.pdf",
    build(
      [
        page(),
        pageObj("/L1 5 0 R"),
        stream(4, `/OC /L1 BDC\n${draw}EMC\n`),
        ocg(5, "Drawn"),
        ocg(6, "Declared Only"),
      ],
      "<< /OCGs [5 0 R 6 0 R] /D << /Order [5 0 R 6 0 R] >> >>",
    ),
  );

  // 7. Print usage contradicts the screen state actually used (PDF-8).
  writeFileSync(
    "ocg-print-differs.pdf",
    build(
      [
        page(),
        pageObj("/L1 5 0 R"),
        stream(4, `/OC /L1 BDC\n${draw}EMC\n`),
        [5, "<< /Type /OCG /Name (Watermark) /Usage << /Print << /PrintState /OFF >> >> >>"],
      ],
      "<< /OCGs [5 0 R] /D << /Order [5 0 R] /AS [<< /Event /Print /OCGs [5 0 R] >>] >> >>",
    ),
  );

  // 8. A membership whose /OCGs names nothing we know — an empty array, or a
  //    group absent from /OCProperties. There is no layer to place content on,
  //    so it is counted rather than silently dropped.
  writeFileSync(
    "ocg-ocmd-empty.pdf",
    build(
      [
        page(),
        pageObj("/M1 8 0 R"),
        stream(4, `/OC /M1 BDC\n${draw}EMC\n`),
        ocg(5, "Declared"),
        [8, "<< /Type /OCMD /OCGs [] >>"],
      ],
      "<< /OCGs [5 0 R] /D << /Order [5 0 R] >> >>",
    ),
  );

  // 9. Two distinct groups declaring the same name — a real corpus file does
  //    this. Layers are keyed by name downstream, so without disambiguation
  //    they merge into one row with one toggle over both.
  writeFileSync(
    "ocg-duplicate-names.pdf",
    build(
      [
        page(),
        pageObj("/L1 5 0 R /L2 6 0 R"),
        stream(4, `/OC /L1 BDC\n${draw}EMC\n/OC /L2 BDC\n${draw}EMC\n`),
        ocg(5, "One"),
        ocg(6, "One"),
      ],
      "<< /OCGs [5 0 R 6 0 R] /D << /Order [5 0 R 6 0 R] >> >>",
    ),
  );

  // 10. Marked content that is NOT /OC — artifacts, spans, tagged structure.
  //     Every BDC opens a mark that EMC closes, so pushing only for /OC while
  //     popping for every EMC desynchronizes the stack and leaks content onto
  //     the wrong layer. Most real marked content carries no /OC at all.
  writeFileSync(
    "ocg-non-oc-marks.pdf",
    build(
      [
        page(),
        pageObj("/L1 5 0 R"),
        stream(
          4,
          // Both a BMC and a non-/OC BDC nested inside the /OC region: if
          // either fails to push, its EMC closes the /OC mark early and the
          // stroke after it falls to "Content".
          `/OC /L1 BDC\n` +
            `/Artifact BMC\n${draw}EMC\n` +
            `/Span << /ActualText (x) >> BDC\n${draw}EMC\n` +
            `${draw}` +
            `EMC\n` +
            `${draw}`,
        ),
        ocg(5, "Marked"),
      ],
      "<< /OCGs [5 0 R] /D << /Order [5 0 R] >> >>",
    ),
  );

  // 11. Unbalanced: an EMC with no BDC, and a BDC never closed. Malformed
  //     input must draw less, never fail (INV-3).
  writeFileSync(
    "ocg-unbalanced-marks.pdf",
    build(
      [
        page(),
        pageObj("/L1 5 0 R"),
        stream(4, `EMC\n${draw}/OC /L1 BDC\n${draw}`),
        ocg(5, "Never Closed"),
      ],
      "<< /OCGs [5 0 R] /D << /Order [5 0 R] >> >>",
    ),
  );

  // A form whose content opens a mark and never closes it.
  const formBody = `${draw}/Artifact BMC\n${draw}`;

  // 12. A form XObject carrying /OC — the corpus uses this as often as marked
  //     content, and three files use only this form.
  writeFileSync(
    "ocg-xobject-oc.pdf",
    build(
      [
        page(),
        [
          3,
          "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /XObject << /F1 7 0 R >> >> >>",
        ],
        // The parent draws after the form returns: if the form's unclosed
        // mark leaks, this stroke lands on the form's layer.
        stream(4, `/F1 Do\n${draw}`),
        ocg(5, "Form Layer"),
        [
          7,
          Buffer.concat([
            enc(
              `<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /OC 5 0 R /Length ${formBody.length} >>\nstream\n`,
            ),
            enc(formBody),
            enc("\nendstream"),
          ]),
        ],
      ],
      "<< /OCGs [5 0 R] /D << /Order [5 0 R] >> >>",
    ),
  );

  // 13. One group carrying content on two pages. Layer identity is
  //     document-wide (PDF-7), so this must be one layer whose count spans
  //     both — not one layer per page. The only multi-page corpus file cannot
  //     prove this: its shared group is an image XObject, so it draws nothing.
  writeFileSync(
    "ocg-multipage-shared.pdf",
    classic([
      [
        1,
        "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R] /D << /Order [7 0 R] >> >> >>",
      ],
      [2, "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /MediaBox [0 0 100 100] >>"],
      [
        3,
        "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Properties << /L1 7 0 R >> >> >>",
      ],
      stream(4, `/OC /L1 BDC\n${draw}EMC\n`),
      [
        5,
        "<< /Type /Page /Parent 2 0 R /Contents 6 0 R /Resources << /Properties << /L1 7 0 R >> >> >>",
      ],
      stream(6, `/OC /L1 BDC\n${draw}${draw}EMC\n`),
      ocg(7, "Shared Across Pages"),
    ]),
  );

  console.log("wrote optional-content fixtures");
}

/* ----------------------------------------------------------------------- */
/* Raster images (PDF-9). Each isolates one decode path.                   */

{
  const page = () => [2, `<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 100 100] >>`];
  /** A page whose content places /Im0 into a w×h rectangle at (x, y). */
  const pageObj = (extraResources = "") => [
    3,
    `<< /Type /Page /Parent 2 0 R /Contents 4 0 R ` +
      `/Resources << /XObject << /Im0 5 0 R >> ${extraResources}>> >>`,
  ];
  const placed = (w, h, x = 10, y = 10, extra = "") => [
    4,
    streamBody(`q ${w} 0 0 ${h} ${x} ${y} cm${extra} /Im0 Do Q\n`),
  ];
  const streamBody = (text) =>
    Buffer.concat([enc(`<< /Length ${text.length} >>\nstream\n`), enc(text), enc("\nendstream")]);
  const imageObj = (num, dictBody, data) => [
    num,
    Buffer.concat([
      enc(`<< /Type /XObject /Subtype /Image ${dictBody} /Length ${data.length} >>\nstream\n`),
      data,
      enc("\nendstream"),
    ]),
  ];
  const flate = (bytes) => deflateSync(Buffer.from(bytes));

  // 1. 2×2 DeviceRGB, distinct corners — orientation-sensitive by design:
  //    row 0 of the samples is the image's TOP edge (red, green).
  writeFileSync(
    "image-flate-rgb.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode",
        flate([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
      ),
    ]),
  );

  // 2. DeviceGray ramp.
  writeFileSync(
    "image-flate-gray.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 4 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode",
        flate([0, 85, 170, 255]),
      ),
    ]),
  );

  // 3. DeviceCMYK with an SMask — the flattened-prepress shape (the RCA
  //    file is exactly this): 2×2 pure C, M, Y, K under a mask that hides
  //    the right column.
  writeFileSync(
    "image-flate-cmyk-smask.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 2 /Height 2 /ColorSpace /DeviceCMYK /BitsPerComponent 8 " +
          "/Filter /FlateDecode /SMask 6 0 R",
        flate([255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255]),
      ),
      imageObj(
        6,
        "/Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode",
        flate([255, 0, 255, 0]),
      ),
    ]),
  );

  // 4. Indexed over DeviceRGB: palette of red/green/blue, 8bpc indices.
  writeFileSync(
    "image-flate-indexed.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 2 /Height 2 /ColorSpace [/Indexed /DeviceRGB 2 6 0 R] " +
          "/BitsPerComponent 8 /Filter /FlateDecode",
        flate([0, 1, 2, 0]),
      ),
      [
        6,
        Buffer.concat([
          enc(`<< /Length 9 >>\nstream\n`),
          Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]),
          enc("\nendstream"),
        ]),
      ],
    ]),
  );

  // 5. 1-bit gray checkerboard: sub-byte sample unpacking, row-aligned.
  //    8×2: rows 0b10101010 (0xAA) and 0b01010101 (0x55).
  writeFileSync(
    "image-1bpc.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode",
        flate([0xaa, 0x55]),
      ),
    ]),
  );

  // 6. 16-bit gray: the high byte carries the value.
  writeFileSync(
    "image-16bpc.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 16 /Filter /FlateDecode",
        flate([0x00, 0x12, 0xff, 0xee]),
      ),
    ]),
  );

  // 7. Decode [1 0] inverts a gray ramp — two corpus DCT images do this.
  writeFileSync(
    "image-decode-invert.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 " +
          "/Decode [1 0] /Filter /FlateDecode",
        flate([0, 255]),
      ),
    ]),
  );

  // 8. Stencil mask: 1bpc, sample 0 paints the current fill colour (red).
  writeFileSync(
    "image-stencil-mask.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      [4, streamBody(`q 1 0 0 rg 40 0 0 40 10 10 cm /Im0 Do Q\n`)],
      // Rows are byte-aligned: row 0 = 0b01000000 ((0,0) paints, (1,0) is
      // clear), row 1 = 0b00000000 (both paint).
      imageObj(5, "/Width 2 /Height 2 /ImageMask true /Filter /FlateDecode", flate([0x40, 0x00])),
    ]),
  );

  // 9. Separation tint ramp: tint is ink coverage, so 1 renders dark —
  //    the K-only photograph convention (PDF-9).
  writeFileSync(
    "image-separation-tint.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 2 /Height 1 /ColorSpace [/Separation /Black /DeviceCMYK 6 0 R] " +
          "/BitsPerComponent 8 /Filter /FlateDecode",
        flate([0, 255]),
      ),
      // A tint-transform function object; present for validity, never run.
      [6, `<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0 0 1] /N 1 >>`],
    ]),
  );

  // 10. An image XObject carrying /OC: its pixels belong to that layer.
  writeFileSync(
    "image-oc-layer.pdf",
    classic([
      [
        1,
        "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << /Order [6 0 R] >> >> >>",
      ],
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /OC 6 0 R",
        flate([0, 128, 255]),
      ),
      [6, `<< /Type /OCG /Name (Artwork) >>`],
    ]),
  );

  // 11. Baseline JPEG (DCTDecode), YCbCr: 16×16 quadrants TL red, TR green,
  //     BL blue, BR yellow. Bytes generated once with macOS sips from a
  //     lossless PNG (see the base64 provenance note below) — committed as
  //     data because fixture generation must not depend on sips.
  writeFileSync(
    "image-jpeg.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
        JPEG_RGB_QUAD,
      ),
    ]),
  );

  // 12. The same quadrants as an Adobe CMYK JPEG (APP14 transform 0,
  //     inverted samples — the classic Photoshop convention): produced by
  //     sips --matchTo "Generic CMYK", ICC APP2 segments stripped.
  writeFileSync(
    "image-jpeg-cmyk-adobe.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      placed(40, 40),
      imageObj(
        5,
        "/Width 16 /Height 16 /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /DCTDecode",
        JPEG_CMYK_QUAD,
      ),
    ]),
  );

  // 13. The dieline-over-artwork flagship (the demo e2e loads this): a
  //     cyan-ish CMYK raster with an SMask fading the right edge, on its
  //     own "Artwork" group (/OC), under two dieline strokes — cut (red)
  //     and crease (green) — that must always read over the artwork.
  {
    const art = [];
    for (let i = 0; i < 16; i++) art.push(200, 0, 0, 40); // cyan-ish CMYK
    const mask = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) mask.push(x < 3 ? 255 : 80);
    const content =
      "q 80 0 0 60 10 20 cm /Im0 Do Q\n" +
      "1 0 0 RG 3 w 10 20 m 90 20 l 90 80 l 10 80 l 10 20 l S\n" +
      "0 1 0 RG 1 w 50 20 m 50 80 l S\n";
    writeFileSync(
      "artwork-dieline.pdf",
      classic([
        [
          1,
          "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R] /D << /Order [7 0 R] >> >> >>",
        ],
        page(),
        pageObj(),
        [4, streamBody(content)],
        imageObj(
          5,
          "/Width 4 /Height 4 /ColorSpace /DeviceCMYK /BitsPerComponent 8 " +
            "/Filter /FlateDecode /SMask 6 0 R /OC 7 0 R",
          flate(art),
        ),
        imageObj(
          6,
          "/Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode",
          flate(mask),
        ),
        [7, `<< /Type /OCG /Name (Artwork) >>`],
      ]),
    );
  }

  // 14. One XObject drawn twice: the document-scoped cache must hand both
  //     placements the same decoded pixels (proven by identity in tests).
  writeFileSync(
    "image-shared-twice.pdf",
    classic([
      catalog,
      page(),
      pageObj(),
      [4, streamBody(`q 30 0 0 30 5 5 cm /Im0 Do Q\nq 30 0 0 30 60 60 cm /Im0 Do Q\n`)],
      imageObj(
        5,
        "/Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode",
        flate([12, 34, 56]),
      ),
    ]),
  );

  console.log("wrote raster-image fixtures");
}
