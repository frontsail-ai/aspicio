import { expect, test } from "vite-plus/test";
import { clearRecents, loadRecents, mergeRecent, pushRecent, type RecentUrl } from "./recents.ts";

const rec = (url: string, over: Partial<RecentUrl> = {}): RecentUrl => ({
  url,
  name: url.split("/").pop() ?? url,
  size: 1024,
  ts: 1,
  ...over,
});

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

test("mergeRecent prepends, dedupes by url, and caps the list", () => {
  const list = [rec("https://a/1.dxf"), rec("https://b/2.dxf")];
  const merged = mergeRecent(list, rec("https://b/2.dxf", { size: 99 }));
  expect(merged.map((r) => r.url)).toEqual(["https://b/2.dxf", "https://a/1.dxf"]);
  expect(merged[0].size).toBe(99); // the fresh copy wins
});

test("mergeRecent caps at five, newest first", () => {
  let list: RecentUrl[] = [];
  for (let i = 0; i < 8; i++) list = mergeRecent(list, rec(`https://h/${i}.dxf`));
  expect(list).toHaveLength(5);
  expect(list[0].url).toBe("https://h/7.dxf");
  expect(list[4].url).toBe("https://h/3.dxf");
});

test("push then load round-trips through the store", () => {
  const store = fakeStore();
  pushRecent(rec("https://a/1.dxf"), store);
  pushRecent(rec("https://b/2.dxf"), store);
  expect(loadRecents(store).map((r) => r.url)).toEqual(["https://b/2.dxf", "https://a/1.dxf"]);
});

test("clearRecents empties the store", () => {
  const store = fakeStore();
  pushRecent(rec("https://a/1.dxf"), store);
  clearRecents(store);
  expect(loadRecents(store)).toEqual([]);
});

test("load tolerates malformed or non-array JSON", () => {
  const store = fakeStore();
  store.setItem("aspicio.recentUrls", "{not json");
  expect(loadRecents(store)).toEqual([]);
  store.setItem("aspicio.recentUrls", JSON.stringify({ nope: true }));
  expect(loadRecents(store)).toEqual([]);
  store.setItem("aspicio.recentUrls", JSON.stringify([{ url: "x" }, rec("https://ok/1.dxf")]));
  expect(loadRecents(store).map((r) => r.url)).toEqual(["https://ok/1.dxf"]); // drops the shapeless entry
});

test("a missing or hostile store degrades to an empty list without throwing", () => {
  expect(loadRecents(null)).toEqual([]);
  expect(() => pushRecent(rec("https://a/1.dxf"), null)).not.toThrow();
  expect(() => clearRecents(null)).not.toThrow();
  const hostile = hostileStore();
  expect(loadRecents(hostile)).toEqual([]);
  expect(() => pushRecent(rec("https://a/1.dxf"), hostile)).not.toThrow();
});
