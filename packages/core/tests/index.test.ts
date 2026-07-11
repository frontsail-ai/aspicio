import { expect, test } from "vite-plus/test";
import { VERSION } from "../src/index.ts";

test("exposes a version", () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
