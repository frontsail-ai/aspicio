// @vitest-environment happy-dom
import { expect, test, vi } from "vite-plus/test";
import type { AspicioPreview } from "../src/index.ts";

/**
 * ELEM-9's unhappy path, in its own file: the format registry is
 * module-global, and nothing unregisters, so "no formats imported" is only
 * observable in a module registry that never imported one.
 */

const mock = vi.hoisted(() => {
  class MockViewer {
    load = vi.fn(() => Promise.resolve());
    loadUrl = vi.fn(() => Promise.resolve());
    dispose = vi.fn();
    getLayers = () => [];
    get stats() {
      return { entityCount: 0, segmentCount: 0, unsupported: {} };
    }
    on(): void {}
    off(): void {}
    constructor(
      public container: HTMLElement,
      public options?: Record<string, unknown>,
    ) {
      instances.push(this);
    }
  }
  const instances: MockViewer[] = [];
  return { MockViewer, instances };
});

vi.mock("@aspicio/core", () => ({
  DrawingViewer: mock.MockViewer,
  DrawingParseError: class extends Error {},
  attachShortcuts: () => () => {},
}));

import "../src/index.ts";
import { registerFormat, registeredFormats } from "../src/formats.ts";

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test("a host that imported no format gets a load error naming the import", async () => {
  const el = document.createElement("aspicio-preview") as AspicioPreview;
  const errors: Error[] = [];
  el.addEventListener("load-error", (e) => errors.push((e as CustomEvent).detail.error as Error));
  el.src = "dxf-data";
  document.body.appendChild(el);
  await flush();

  expect(errors).toHaveLength(1);
  expect(errors[0]?.message).toContain("@aspicio/elements/formats/dxf");
  // The load never reached the viewer — the element short-circuits it.
  expect(mock.instances[0]?.load).not.toHaveBeenCalled();
});

test("registerFormat ignores a format that is already registered", () => {
  const parser = { format: "stub", sniff: () => false, parse: () => ({}) as never };
  registerFormat(parser);
  registerFormat({ ...parser });
  expect(registeredFormats().filter((p) => p.format === "stub")).toHaveLength(1);
});
