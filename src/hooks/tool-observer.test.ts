import { describe, it, expect, beforeEach } from "bun:test";
import {
  createToolObserver,
  getSessionState,
  resetSessionState,
  type ToolObserverInput,
  type ToolObserverOutput,
} from "./tool-observer";

function makeInput(overrides: Partial<ToolObserverInput> = {}): ToolObserverInput {
  return {
    tool: "nia_search",
    sessionID: "session-1",
    callID: "call-1",
    args: { query: "test query" },
    ...overrides,
  };
}

function makeOutput(overrides: Partial<ToolObserverOutput> = {}): ToolObserverOutput {
  return {
    title: "Search Results",
    output: "# Results\nSome content here",
    metadata: {},
    ...overrides,
  };
}

describe("createToolObserver", () => {
  beforeEach(() => {
    resetSessionState();
  });

  it("returns a function matching tool.execute.after signature", () => {
    const observer = createToolObserver();
    expect(typeof observer).toBe("function");
  });

  describe("nia_* tool filtering", () => {
    it("processes nia_search tool calls", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "nia_search" }), makeOutput());

      const state = getSessionState();
      expect(state.usage.totalCalls).toBe(1);
    });

    it("processes nia_read tool calls", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "nia_read" }), makeOutput());

      const state = getSessionState();
      expect(state.usage.totalCalls).toBe(1);
    });

    it("processes nia_grep tool calls", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "nia_grep" }), makeOutput());

      const state = getSessionState();
      expect(state.usage.totalCalls).toBe(1);
    });

    it("processes nia_research tool calls", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "nia_research" }), makeOutput());

      const state = getSessionState();
      expect(state.usage.totalCalls).toBe(1);
    });

    it("ignores non-nia tools", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "bash" }), makeOutput());

      const state = getSessionState();
      expect(state.usage.totalCalls).toBe(0);
    });

    it("ignores tools with nia in name but not as prefix", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "my_nia_tool" }), makeOutput());

      const state = getSessionState();
      expect(state.usage.totalCalls).toBe(0);
    });
  });

  describe("result caching", () => {
    it("caches nia_search results keyed by callID", async () => {
      const observer = createToolObserver();
      const input = makeInput({ tool: "nia_search", callID: "call-abc" });
      const output = makeOutput({ output: "search results markdown" });

      await observer(input, output);

      const state = getSessionState();
      expect(state.cache.has("call-abc")).toBe(true);
      expect(state.cache.get("call-abc")?.output).toBe("search results markdown");
    });

    it("caches nia_read results", async () => {
      const observer = createToolObserver();
      await observer(
        makeInput({ tool: "nia_read", callID: "call-read-1" }),
        makeOutput({ output: "file content here" }),
      );

      const state = getSessionState();
      expect(state.cache.has("call-read-1")).toBe(true);
    });

    it("caches nia_grep results", async () => {
      const observer = createToolObserver();
      await observer(
        makeInput({ tool: "nia_grep", callID: "call-grep-1" }),
        makeOutput({ output: "grep matches" }),
      );

      const state = getSessionState();
      expect(state.cache.has("call-grep-1")).toBe(true);
    });

    it("does NOT cache non-cacheable nia tools", async () => {
      const observer = createToolObserver();
      await observer(
        makeInput({ tool: "nia_index", callID: "call-idx" }),
        makeOutput(),
      );

      const state = getSessionState();
      expect(state.cache.has("call-idx")).toBe(false);
    });

    it("stores tool name, args, and sessionID in cached entry", async () => {
      const observer = createToolObserver();
      const args = { query: "embeddings", search_mode: "universal" };
      await observer(
        makeInput({ tool: "nia_search", callID: "call-full", sessionID: "s-42", args }),
        makeOutput({ output: "result text", title: "Nia Search" }),
      );

      const entry = getSessionState().cache.get("call-full");
      expect(entry).toBeDefined();
      expect(entry!.toolName).toBe("nia_search");
      expect(entry!.sessionID).toBe("s-42");
      expect(entry!.args).toEqual(args);
      expect(entry!.title).toBe("Nia Search");
    });
  });

  describe("usage statistics", () => {
    it("tracks total call count", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "nia_search" }), makeOutput());
      await observer(makeInput({ tool: "nia_read", callID: "call-2" }), makeOutput());
      await observer(makeInput({ tool: "nia_grep", callID: "call-3" }), makeOutput());

      const state = getSessionState();
      expect(state.usage.totalCalls).toBe(3);
    });

    it("tracks per-tool call counts", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "nia_search", callID: "c1" }), makeOutput());
      await observer(makeInput({ tool: "nia_search", callID: "c2" }), makeOutput());
      await observer(makeInput({ tool: "nia_read", callID: "c3" }), makeOutput());

      const state = getSessionState();
      expect(state.usage.byTool.nia_search).toBe(2);
      expect(state.usage.byTool.nia_read).toBe(1);
    });

    it("initializes per-tool count on first call", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "nia_tracer", callID: "c1" }), makeOutput());

      const state = getSessionState();
      expect(state.usage.byTool.nia_tracer).toBe(1);
    });

    it("does not count non-nia tool calls", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "bash" }), makeOutput());
      await observer(makeInput({ tool: "read_file" }), makeOutput());

      const state = getSessionState();
      expect(state.usage.totalCalls).toBe(0);
      expect(Object.keys(state.usage.byTool)).toHaveLength(0);
    });

    it("records timestamp of last call", async () => {
      const before = Date.now();
      const observer = createToolObserver();
      await observer(makeInput({ tool: "nia_search" }), makeOutput());
      const after = Date.now();

      const state = getSessionState();
      expect(state.usage.lastCallAt).toBeGreaterThanOrEqual(before);
      expect(state.usage.lastCallAt).toBeLessThanOrEqual(after);
    });
  });

  describe("resetSessionState", () => {
    it("clears all cached data and usage stats", async () => {
      const observer = createToolObserver();
      await observer(makeInput({ tool: "nia_search", callID: "c1" }), makeOutput());
      await observer(makeInput({ tool: "nia_read", callID: "c2" }), makeOutput());

      expect(getSessionState().usage.totalCalls).toBe(2);

      resetSessionState();

      const state = getSessionState();
      expect(state.usage.totalCalls).toBe(0);
      expect(state.cache.size).toBe(0);
      expect(Object.keys(state.usage.byTool)).toHaveLength(0);
    });
  });

  describe("error resilience", () => {
    it("does not throw on any input", async () => {
      const observer = createToolObserver();
      await expect(
        observer(makeInput({ tool: "nia_search" }), makeOutput()),
      ).resolves.toBeUndefined();
    });

    it("handles empty output gracefully", async () => {
      const observer = createToolObserver();
      await expect(
        observer(
          makeInput({ tool: "nia_search" }),
          makeOutput({ output: "", title: "" }),
        ),
      ).resolves.toBeUndefined();

      expect(getSessionState().usage.totalCalls).toBe(1);
    });
  });
});
