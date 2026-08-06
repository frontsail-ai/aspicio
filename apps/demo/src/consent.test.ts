import { expect, test } from "vite-plus/test";
import { clearConsent, loadConsent, saveConsent } from "./consent.ts";

/** A minimal in-memory Storage stand-in for the node test env. */
function fakeStore(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

/** A Storage whose every method throws, mimicking private-mode browsers. */
function hostileStore(): Storage {
  const boom = (): never => {
    throw new Error("denied");
  };
  return {
    length: 0,
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  };
}

test("an unanswered visitor reads as null, never as consent", () => {
  expect(loadConsent(fakeStore())).toBe(null);
});

test("a saved choice round-trips", () => {
  const store = fakeStore();
  saveConsent("granted", store);
  expect(loadConsent(store)).toBe("granted");
  saveConsent("denied", store);
  expect(loadConsent(store)).toBe("denied");
});

test("clearing makes the banner ask again", () => {
  const store = fakeStore();
  saveConsent("granted", store);
  clearConsent(store);
  expect(loadConsent(store)).toBe(null);
});

test("an unrecognised stored value re-asks rather than granting", () => {
  const store = fakeStore();
  // Anything a future version, a typo, or a hand-edited devtools session could
  // leave behind must fail closed.
  for (const bogus of ["yes", "true", "GRANTED", "", "{}", "null"]) {
    store.setItem("aspicio.analyticsConsent", bogus);
    expect(loadConsent(store)).toBe(null);
  }
});

test("a missing store reads null and writes without throwing", () => {
  expect(loadConsent(null)).toBe(null);
  expect(saveConsent("granted", null)).toBe("granted");
  clearConsent(null);
});

test("a private-mode store that throws never breaks the page", () => {
  const store = hostileStore();
  expect(loadConsent(store)).toBe(null);
  expect(saveConsent("granted", store)).toBe("granted");
  clearConsent(store);
});
