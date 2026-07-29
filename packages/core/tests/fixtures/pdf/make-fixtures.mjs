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
