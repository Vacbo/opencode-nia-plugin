import { describe, expect, it } from "bun:test";

import { BoundedMap, TTLCache } from "./cache.js";

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

	it("purges expired entries on set()", () => {
		let now = 1_000;
		const cache = new TTLCache<string, string>({ ttl: 100, now: () => now });

		cache.set("a", "one");
		cache.set("b", "two");

		// Advance past TTL so both entries expire
		now += 200;

		// The next set() should trigger a purge of expired entries
		cache.set("c", "three");

		// "a" and "b" should have been purged (not just lazily on get)
		expect(cache.size).toBe(1);
	});

	it("respects maxSize and evicts oldest entries (LRU)", () => {
		const cache = new TTLCache<string, string>({ ttl: 60_000, maxSize: 3 });

		cache.set("a", "one");
		cache.set("b", "two");
		cache.set("c", "three");
		cache.set("d", "four"); // should evict "a"

		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("b")).toBe("two");
		expect(cache.get("c")).toBe("three");
		expect(cache.get("d")).toBe("four");
		expect(cache.size).toBe(3);
	});

	it("re-accessing an entry prevents it from being evicted", () => {
		const now = 1_000;
		const cache = new TTLCache<string, string>({
			ttl: 60_000,
			maxSize: 3,
			now: () => now,
		});

		cache.set("a", "one");
		cache.set("b", "two");
		cache.set("c", "three");

		// Access "a" to refresh its position
		cache.get("a");

		// Add "d" - should evict "b" (oldest untouched), not "a"
		cache.set("d", "four");

		expect(cache.get("a")).toBe("one");
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("c")).toBe("three");
		expect(cache.get("d")).toBe("four");
	});
});

describe("BoundedMap", () => {
	it("stores and retrieves values", () => {
		const map = new BoundedMap<string, number>(10);
		map.set("a", 1);
		expect(map.get("a")).toBe(1);
	});

	it("respects maxSize and evicts LRU entries", () => {
		const map = new BoundedMap<string, number>(3);

		map.set("a", 1);
		map.set("b", 2);
		map.set("c", 3);
		map.set("d", 4); // evicts "a"

		expect(map.get("a")).toBeUndefined();
		expect(map.get("b")).toBe(2);
		expect(map.get("c")).toBe(3);
		expect(map.get("d")).toBe(4);
		expect(map.size).toBe(3);
	});

	it("refreshes LRU position on get()", () => {
		const map = new BoundedMap<string, number>(3);

		map.set("a", 1);
		map.set("b", 2);
		map.set("c", 3);

		// Touch "a" so it's no longer LRU
		map.get("a");

		map.set("d", 4); // evicts "b" (now oldest untouched)

		expect(map.get("a")).toBe(1);
		expect(map.get("b")).toBeUndefined();
	});

	it("refreshes LRU position on set() update", () => {
		const map = new BoundedMap<string, number>(3);

		map.set("a", 1);
		map.set("b", 2);
		map.set("c", 3);

		// Update "a" refreshes its position
		map.set("a", 10);

		map.set("d", 4); // evicts "b"

		expect(map.get("a")).toBe(10);
		expect(map.get("b")).toBeUndefined();
	});

	it("supports delete and clear", () => {
		const map = new BoundedMap<string, number>(10);

		map.set("a", 1);
		map.set("b", 2);

		map.delete("a");
		expect(map.get("a")).toBeUndefined();
		expect(map.size).toBe(1);

		map.clear();
		expect(map.size).toBe(0);
	});

	it("supports has() and entries()", () => {
		const map = new BoundedMap<string, number>(10);

		map.set("x", 42);
		expect(map.has("x")).toBe(true);
		expect(map.has("y")).toBe(false);

		const entries = [...map.entries()];
		expect(entries).toEqual([["x", 42]]);
	});
});
