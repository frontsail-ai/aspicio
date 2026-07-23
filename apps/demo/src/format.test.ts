import { expect, test } from "vite-plus/test";
import { formatBytes } from "./format.ts";

test("formats bytes below 1 KB with a B suffix", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1023)).toBe("1023 B");
});

test("formats kilobytes as whole KB", () => {
  expect(formatBytes(1024)).toBe("1 KB");
  expect(formatBytes(73728)).toBe("72 KB");
  expect(formatBytes(1048575)).toBe("1024 KB");
});

test("formats megabytes with one decimal", () => {
  expect(formatBytes(1048576)).toBe("1.0 MB");
  expect(formatBytes(1258291)).toBe("1.2 MB");
});

test("returns an em dash for unknown or invalid sizes", () => {
  expect(formatBytes(null)).toBe("—");
  expect(formatBytes(undefined)).toBe("—");
  expect(formatBytes(Number.NaN)).toBe("—");
  expect(formatBytes(-5)).toBe("—");
});
