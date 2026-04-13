import { beforeEach, describe, expect, it } from "bun:test";

import {
	getSessionState,
	removeSessionState,
	resetSessionStates,
} from "./session.js";

describe("getSessionState", () => {
	beforeEach(() => {
		resetSessionStates();
	});

	it("returns the same state object for the same session", () => {
		const stateA = getSessionState("session-shared");
		const stateB = getSessionState("session-shared");

		expect(stateA).toBe(stateB);
	});

	it("isolates cache, dedup state, ops, and project context per session", () => {
		const alpha = getSessionState("session-alpha");
		const beta = getSessionState("session-beta");

		alpha.sourceCache.set("source-1", { id: "source-1", type: "repository" });
		alpha.searchDedup.set("query:repo", true);
		alpha.projectContext.set("cwd", "/tmp/alpha");
		alpha.pendingOps.trackOperation({
			id: "op-1",
			type: "oracle",
			name: "Alpha research",
		});
		alpha.toolExecuteAfterCount += 1;
		alpha.systemTransformCount += 1;
		alpha.cache.set("call-1", {
			toolName: "nia_search",
			sessionID: "session-alpha",
			callID: "call-1",
			args: { query: "alpha" },
			output: "alpha result",
			title: "Alpha Search",
			cachedAt: Date.now(),
		});
		alpha.usage.totalCalls += 1;
		alpha.usage.byTool.nia_search = 1;
		alpha.usage.lastCallAt = Date.now();

		expect(beta.sourceCache.get("source-1")).toBeUndefined();
		expect(beta.searchDedup.get("query:repo")).toBeUndefined();
		expect(beta.projectContext.get("cwd")).toBeUndefined();
		expect(beta.pendingOps.getOperation("op-1")).toBeUndefined();
		expect(beta.toolExecuteAfterCount).toBe(0);
		expect(beta.systemTransformCount).toBe(0);
		expect(beta.cache.get("call-1")).toBeUndefined();
		expect(beta.usage.totalCalls).toBe(0);
		expect(Object.keys(beta.usage.byTool)).toHaveLength(0);
		expect(beta.usage.lastCallAt).toBe(0);
	});

	it("removes a session so the next lookup gets fresh state", () => {
		const original = getSessionState("session-cleanup");
		original.toolExecuteAfterCount = 9;

		removeSessionState("session-cleanup");

		const recreated = getSessionState("session-cleanup");
		expect(recreated).not.toBe(original);
		expect(recreated.toolExecuteAfterCount).toBe(0);
	});

	it("evicts the least recently used session once the store exceeds 100 sessions", () => {
		const oldest = getSessionState("session-0");

		for (let index = 1; index <= 100; index += 1) {
			getSessionState(`session-${index}`);
		}

		const recreatedOldest = getSessionState("session-0");
		expect(recreatedOldest).not.toBe(oldest);
	});

	it("bounds NiaSessionState.cache to 500 entries with LRU eviction", () => {
		const state = getSessionState("session-bounded-cache");

		for (let i = 0; i < 500; i++) {
			state.cache.set(`call-${i}`, {
				toolName: "nia_search",
				sessionID: "session-bounded-cache",
				callID: `call-${i}`,
				args: {},
				output: `result-${i}`,
				title: `Search ${i}`,
				cachedAt: Date.now(),
			});
		}

		expect(state.cache.size).toBe(500);

		state.cache.set("call-overflow", {
			toolName: "nia_search",
			sessionID: "session-bounded-cache",
			callID: "call-overflow",
			args: {},
			output: "overflow",
			title: "Overflow",
			cachedAt: Date.now(),
		});

		expect(state.cache.size).toBe(500);
		expect(state.cache.get("call-0")).toBeUndefined();
		expect(state.cache.get("call-overflow")).toBeDefined();
	});

	it("bounds NiaSessionState.projectContext to 100 entries with LRU eviction", () => {
		const state = getSessionState("session-bounded-ctx");

		for (let i = 0; i < 100; i++) {
			state.projectContext.set(`key-${i}`, `value-${i}`);
		}

		expect(state.projectContext.size).toBe(100);

		state.projectContext.set("key-overflow", "overflow");

		expect(state.projectContext.size).toBe(100);
		expect(state.projectContext.get("key-0")).toBeUndefined();
		expect(state.projectContext.get("key-overflow")).toBe("overflow");
	});

	it("refreshes LRU position on get() for bounded maps", () => {
		const state = getSessionState("session-lru");

		for (let i = 0; i < 100; i++) {
			state.projectContext.set(`key-${i}`, `value-${i}`);
		}

		state.projectContext.get("key-0");

		state.projectContext.set("key-overflow", "overflow");

		expect(state.projectContext.get("key-0")).toBe("value-0");
		expect(state.projectContext.get("key-1")).toBeUndefined();
	});
});
