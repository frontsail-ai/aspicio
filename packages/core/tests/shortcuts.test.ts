// @vitest-environment happy-dom
import { expect, test, vi } from "vite-plus/test";
import { attachShortcuts } from "../src/input/shortcuts.ts";
import type { ShortcutHandlers, ShortcutViewer } from "../src/input/shortcuts.ts";

function makeViewer() {
  return { fitView: vi.fn(), zoomBy: vi.fn(), resetRotation: vi.fn() };
}

/** A fresh target element with shortcuts attached — isolates each test. */
function setup(handlers?: ShortcutHandlers) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const viewer = makeViewer();
  const detach = attachShortcuts(el, viewer as ShortcutViewer, handlers);
  return { el, viewer, detach };
}

function key(target: EventTarget, k: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

test("camera keys drive the viewer directly", () => {
  const { el, viewer } = setup();
  key(el, "f");
  expect(viewer.fitView).toHaveBeenCalled();
  key(el, "+");
  key(el, "=");
  expect(viewer.zoomBy).toHaveBeenCalledTimes(2);
  expect(viewer.zoomBy.mock.calls[0][0]).toBeGreaterThan(1);
  key(el, "-");
  expect(viewer.zoomBy.mock.calls[2][0]).toBeLessThan(1);
  key(el, "R");
  expect(viewer.resetRotation).toHaveBeenCalled();
});

test("app keys delegate to handlers and preventDefault when handled", () => {
  const h: ShortcutHandlers = {
    onToggleMeasure: vi.fn(),
    onIsolate: vi.fn(),
    onHide: vi.fn(),
    onCopy: vi.fn(),
    onShowAll: vi.fn(),
    onToggleHelp: vi.fn(),
    onEscape: vi.fn(),
  };
  const { el } = setup(h);
  for (const [k, fn] of [
    ["m", h.onToggleMeasure],
    ["i", h.onIsolate],
    ["h", h.onHide],
    ["c", h.onCopy],
    ["a", h.onShowAll],
    ["?", h.onToggleHelp],
    ["Escape", h.onEscape],
  ] as const) {
    const e = key(el, k);
    expect(fn).toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  }
});

test("unhandled or unbound keys do not preventDefault", () => {
  const { el } = setup({}); // no app handlers bound
  expect(key(el, "z").defaultPrevented).toBe(false); // not a shortcut
  expect(key(el, "m").defaultPrevented).toBe(false); // shortcut, but no handler
});

test("guards: isEnabled, modifiers, form fields, and key repeat", () => {
  let enabled = false;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const viewer = makeViewer();
  attachShortcuts(el, viewer as ShortcutViewer, { isEnabled: () => enabled });

  key(el, "f");
  expect(viewer.fitView).not.toHaveBeenCalled(); // gated off
  enabled = true;
  key(el, "f", { metaKey: true });
  key(el, "f", { ctrlKey: true });
  key(el, "f", { repeat: true });
  expect(viewer.fitView).not.toHaveBeenCalled(); // modifiers + repeat ignored
  key(el, "f");
  expect(viewer.fitView).toHaveBeenCalledTimes(1);

  // Typing into a form field bubbles up but is ignored.
  const input = document.createElement("input");
  el.appendChild(input);
  key(input, "f");
  expect(viewer.fitView).toHaveBeenCalledTimes(1);
});

test("detach removes the listener", () => {
  const { el, viewer, detach } = setup();
  detach();
  key(el, "f");
  expect(viewer.fitView).not.toHaveBeenCalled();
});
