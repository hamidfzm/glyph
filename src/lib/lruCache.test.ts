import { describe, expect, it } from "vitest";
import { LruCache } from "./lruCache";

describe("LruCache", () => {
  it("stores and retrieves values", () => {
    const cache = new LruCache<string>(2);
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts the oldest entry past the limit", () => {
    const cache = new LruCache<string>(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
    expect(cache.size).toBe(2);
  });

  it("get refreshes recency, protecting the entry from eviction", () => {
    const cache = new LruCache<string>(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a");
    cache.set("c", "3");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
  });

  it("set on an existing key updates the value without evicting", () => {
    const cache = new LruCache<string>(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("a", "updated");
    expect(cache.get("a")).toBe("updated");
    expect(cache.get("b")).toBe("2");
    expect(cache.size).toBe(2);
  });

  it("delete removes an entry", () => {
    const cache = new LruCache<string>(1);
    cache.set("a", "1");
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
