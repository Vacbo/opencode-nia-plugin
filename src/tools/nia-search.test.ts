import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import type { NiaClient } from "../api/client";
import type { NiaConfig } from "../config";
import { createNiaSearchTool, niaSearchArgsSchema } from "./nia-search";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] } } as NiaConfig;

function createContext(signal?: AbortSignal): ToolContext {
	const controller = new AbortController();
	return {
		sessionID: "session-1",
		messageID: "message-1",
		agent: "test",
		directory: "/tmp/project",
		worktree: "/tmp/project",
		abort: signal ?? controller.signal,
		metadata() {},
		ask: async () => {},
	};
}

describe("nia_search tool", () => {
  it("formats universal search results as markdown and forwards defaults", async () => {
    let capturedPath = "";
    let capturedBody: Record<string, unknown> | undefined;

    const client = {
      post: async (path: string, body?: unknown) => {
        capturedPath = path;
        capturedBody = body as Record<string, unknown>;
        return {
          query: "vector databases",
          total: 1,
          results: [
            { id: "res_1", source_id: "repo_1", source_type: "repository", title: "Semantic Search Guide", content: "Use embeddings and chunking for retrieval quality.", url: "https://example.com/guide", file_path: "docs/search.md", score: 0.98, highlights: ["embeddings", "chunking"] },
          ],
        };
      },
    };

    const niaSearchTool = createNiaSearchTool(client as unknown as NiaClient, TEST_CONFIG);
    const args = niaSearchArgsSchema.parse({ query: "vector databases" });
    const context = createContext();
    const result = await niaSearchTool.execute(args, context);

    expect(capturedPath).toBe("/search");
    expect(capturedBody).toMatchObject({ query: "vector databases", mode: "universal", max_tokens: 5000, include_sources: true, num_results: 10 });
    expect(result).toContain("# Nia Search");
    expect(result).toContain("## Results");
    expect(result).toContain("Semantic Search Guide");
    expect(result).toContain("https://example.com/guide");
    expect(result).toContain("docs/search.md");
    expect(result).toContain("embeddings");
    expect(result).not.toContain('"results"');
  });

  it("formats query mode answers with sources", async () => {
    const client = {
      post: async () => ({
        answer: "Use dependency injection so the tool can be tested without live API calls.",
        citations: ["src/api/client.ts"],
        sources: [{ id: "res_2", source_id: "repo_2", source_type: "repository", title: "Client implementation", content: "The client wraps fetch with retries and typed helpers.", file_path: "src/api/client.ts", score: 0.91 }],
      }),
    };

    const niaSearchTool = createNiaSearchTool(client as unknown as NiaClient, TEST_CONFIG);
    const args = niaSearchArgsSchema.parse({ query: "How should I test this?", search_mode: "query" });
    const result = await niaSearchTool.execute(args, createContext());

    expect(result).toContain("## Answer");
    expect(result).toContain("dependency injection");
    expect(result).toContain("## Sources");
    expect(result).toContain("Client implementation");
    expect(result).toContain("## Citations");
    expect(result).toContain("src/api/client.ts");
  });

  for (const [label, error] of [
    ["401", "unauthorized [401]: bad key"],
    ["403", "forbidden [403]: missing scope"],
    ["404", "not_found [404]: search mode unavailable"],
    ["429", "rate_limited [429]: slow down (retry-after=1)"],
    ["500", "server_error [500]: upstream exploded"],
  ] as const) {
    it(`returns the ${label} client error string without throwing`, async () => {
      const niaSearchTool = createNiaSearchTool({ post: async () => error } as unknown as NiaClient, TEST_CONFIG);
      const result = await niaSearchTool.execute(niaSearchArgsSchema.parse({ query: "search failures" }), createContext());
      expect(result).toBe(error);
    });
  }

  it("returns a friendly empty-results markdown message", async () => {
    const niaSearchTool = createNiaSearchTool({ post: async () => ({ query: "nothing", total: 0, results: [] }) } as unknown as NiaClient, TEST_CONFIG);
    const result = await niaSearchTool.execute(niaSearchArgsSchema.parse({ query: "nothing" }), createContext());
    expect(result).toContain("No results found");
    expect(result).toContain("nothing");
  });

  it("returns an abort string when the request signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const niaSearchTool = createNiaSearchTool({ post: async () => { throw new Error("should not reach client"); } } as unknown as NiaClient, TEST_CONFIG);
    const result = await niaSearchTool.execute(niaSearchArgsSchema.parse({ query: "cancel me" }), createContext(controller.signal));
    expect(result).toContain("abort_error");
  });

  it("truncates long markdown output and appends a marker", async () => {
    const longContent = "A".repeat(800);
    const niaSearchTool = createNiaSearchTool({
      post: async () => ({ query: "very long", total: 1, results: [{ id: "res_3", source_id: "repo_3", source_type: "repository", title: "Long result", content: longContent, score: 0.8 }] }),
    } as unknown as NiaClient, TEST_CONFIG);
    const result = await niaSearchTool.execute(niaSearchArgsSchema.parse({ query: "very long", max_tokens: 120 }), createContext());
    expect(result).toContain("[truncated]");
    expect(result.length).toBeLessThanOrEqual(120 + "\n\n[truncated]".length);
  });
});
