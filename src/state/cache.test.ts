import { describe, expect, it } from "bun:test";

import { TTLCache } from "./cache.js";

describe("TTLCache", () => {
  it("returns cached values until they expire", () => {
    let now = 1_000;
    const cache = new TTLCache<string, string>({ ttl: 500, now: () => now });

    cache.set("repo", "ready");
    expect(cache.get("repo")).toBe("ready");

    now += 499;
    expect(cache.get("repo")).toBe("ready");

    now += 1;
    expect(cache.get("repo")).toBeUndefined();
  });

  it("supports per-entry ttl overrides and delete", () => {
    let now = 5_000;
    const cache = new TTLCache<string, number>({ ttl: 10_000, now: () => now });

    cache.set("search", 1, 100);
    expect(cache.get("search")).toBe(1);

    now += 101;
    expect(cache.get("search")).toBeUndefined();

    cache.set("search", 2);
    cache.delete("search");
    expect(cache.get("search")).toBeUndefined();
  });

  it("clears all cached values", () => {
    const cache = new TTLCache<string, string>({ ttl: 1_000 });

    cache.set("a", "one");
    cache.set("b", "two");
    cache.clear();

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});
