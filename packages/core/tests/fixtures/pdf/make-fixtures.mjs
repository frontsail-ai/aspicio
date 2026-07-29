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

console.log("wrote 9 fixtures");
