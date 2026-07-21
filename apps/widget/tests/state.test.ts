import { expect, test } from "vite-plus/test";
import { INLINE_EMBED_BYTES, VIEWER_META_KEY, type ViewerMeta } from "../src/meta.ts";
import {
  actionForToolResult,
  base64ToBytes,
  concatChunks,
  cssColor,
  formatBytes,
  statusChip,
} from "../src/state.ts";

const meta = (m: ViewerMeta) => ({ _meta: { [VIEWER_META_KEY]: m } });

test("a result without the viewer meta yields no action", () => {
  expect(actionForToolResult({})).toEqual({ kind: "missing" });
  expect(actionForToolResult({ _meta: { other: 1 } })).toEqual({ kind: "missing" });
});

test("an embedded drawing decodes back to the original bytes", () => {
  const dxf = "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n";
  const action = actionForToolResult(
    meta({ dxfBase64: btoa(dxf), byteLength: dxf.length, allowFilePicker: false }),
  );
  if (action.kind !== "load") throw new Error(`expected load, got ${action.kind}`);
  expect(new TextDecoder().decode(action.bytes)).toBe(dxf);
});

test("file-picker controls stay off unless the server enabled them (AGT-14)", () => {
  const m = { dxfBase64: btoa("x"), byteLength: 1 };
  const off = actionForToolResult(meta({ ...m, allowFilePicker: false }));
  const on = actionForToolResult(meta({ ...m, allowFilePicker: true }));
  expect(off).toMatchObject({ kind: "load", allowFilePicker: false });
  expect(on).toMatchObject({ kind: "load", allowFilePicker: true });
  // A missing/malformed flag must fail closed.
  const absent = actionForToolResult(meta({ ...m } as ViewerMeta));
  expect(absent).toMatchObject({ kind: "load", allowFilePicker: false });
});

test("a source-only payload becomes a pull action (large URL drawings)", () => {
  const action = actionForToolResult(
    meta({ source: "https://x.test/big.dxf", byteLength: 1_117_143, allowFilePicker: false }),
  );
  expect(action).toEqual({
    kind: "pull",
    source: "https://x.test/big.dxf",
    byteLength: 1_117_143,
    allowFilePicker: false,
  });
});

test("an undeliverable drawing degrades to a too-large notice, never a load", () => {
  const action = actionForToolResult(
    meta({ tooLarge: true, byteLength: INLINE_EMBED_BYTES + 1, allowFilePicker: false }),
  );
  expect(action).toEqual({ kind: "too-large", byteLength: INLINE_EMBED_BYTES + 1 });
});

test("pulled chunks reassemble in order", () => {
  const joined = new Uint8Array(
    concatChunks([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])]),
  );
  expect([...joined]).toEqual([1, 2, 3, 4, 5, 6]);
});

test("base64 round-trips binary bytes", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
  const b64 = btoa(String.fromCharCode(...bytes));
  expect(new Uint8Array(base64ToBytes(b64))).toEqual(bytes);
});

test("layer swatch colors render as CSS hex", () => {
  expect(cssColor(0xff0000)).toBe("#ff0000");
  expect(cssColor(0x0000ff)).toBe("#0000ff");
  expect(cssColor(0)).toBe("#000000");
});

test("byte sizes format as KB below 1 MB and one-decimal MB above", () => {
  expect(formatBytes(500)).toBe("1 KB");
  expect(formatBytes(128 * 1024)).toBe("128 KB");
  expect(formatBytes(7 * 1024 * 1024)).toBe("7.0 MB");
});

test("the status chip is singular-safe", () => {
  expect(statusChip(6, 128 * 1024)).toBe("6 LAYERS · 128 KB");
  expect(statusChip(1, 2048)).toBe("1 LAYER · 2 KB");
});
