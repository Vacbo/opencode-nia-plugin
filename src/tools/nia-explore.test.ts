import { describe, expect, it } from "bun:test";

import { NiaClient, type FetchFn } from "../api/client.js";
import type { ToolContext } from "@opencode-ai/plugin";
import type { NiaConfig } from "../config.js";
import { createNiaExploreTool } from "./nia-explore.js";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] } } as NiaConfig;

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(
  handlers: Array<{ match: string; response: unknown; status?: number }>,
): FetchFn {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const h of handlers) {
      if (url.includes(h.match)) {
        return jsonResponse(h.status ?? 200, h.response);
      }
    }
    return jsonResponse(404, { message: "not found" });
  };
}

function mockContext(): ToolContext {
  return {
    sessionID: "s1",
    messageID: "m1",
    agent: "test",
    directory: "/test",
    worktree: "/test",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  };
}

describe("nia_explore", () => {
  it("returns formatted tree for a repository", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        {
          match: "/repositories/repo-1/tree",
          response: {
            repository: "owner/repo",
            branch: "main",
            tree: [
              { path: "src", type: "directory" },
              { path: "README.md", type: "file", size: 1024 },
            ],
          },
        },
      ]),
    });

    const tool = createNiaExploreTool(client, TEST_CONFIG);
    const result = await tool.execute(
      { source_id: "repo-1", source_type: "repository" },
      mockContext(),
    );

    expect(result).toContain("owner/repo");
    expect(result).toContain("main");
    expect(result).toContain("src");
    expect(result).toContain("README.md");
    expect(result).toContain("1024");
  });

  it("renders nested directory tree with children", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        {
          match: "/repositories/repo-1/tree",
          response: {
            repository: "owner/repo",
            branch: "main",
            tree: [
              {
                path: "src",
                type: "directory",
                children: [
                  { path: "index.ts", type: "file", size: 200 },
                  {
                    path: "utils",
                    type: "directory",
                    children: [
                      { path: "helper.ts", type: "file", size: 50 },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ]),
    });

    const tool = createNiaExploreTool(client, TEST_CONFIG);
    const result = await tool.execute(
      { source_id: "repo-1", source_type: "repository" },
      mockContext(),
    );

    expect(result).toContain("src");
    expect(result).toContain("index.ts");
    expect(result).toContain("utils");
    expect(result).toContain("helper.ts");
    const srcIdx = result.indexOf("src");
    const indexIdx = result.indexOf("index.ts");
    expect(indexIdx).toBeGreaterThan(srcIdx);
  });

  it("passes path and max_depth as query params", async () => {
    let capturedUrl = "";
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return jsonResponse(200, {
          repository: "r",
          branch: "main",
          tree: [{ path: "sub/file.ts", type: "file", size: 10 }],
        });
      },
    });

    const tool = createNiaExploreTool(client, TEST_CONFIG);
    await tool.execute(
      { source_id: "repo-1", source_type: "repository", path: "src/components", max_depth: 2 },
      mockContext(),
    );

    expect(capturedUrl).toContain("path=src");
    expect(capturedUrl).toContain("max_depth=2");
  });

  it("returns API error on failure", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        {
          match: "/repositories/repo-1/tree",
          response: { message: "not found" },
          status: 404,
        },
      ]),
    });

    const tool = createNiaExploreTool(client, TEST_CONFIG);
    const result = await tool.execute(
      { source_id: "repo-1", source_type: "repository" },
      mockContext(),
    );

    expect(result).toContain("not_found");
    expect(result).toContain("404");
  });

  it("resolves source via source_type + identifier", async () => {
    let treeUrl = "";
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/sources")) {
          return jsonResponse(200, {
            sources: [{ id: "r-id", type: "repository" }],
            total: 1,
          });
        }
        if (url.includes("/repositories/r-id/tree")) {
          treeUrl = url;
          return jsonResponse(200, {
            repository: "owner/repo",
            branch: "main",
            tree: [{ path: "file.ts", type: "file", size: 5 }],
          });
        }
        return jsonResponse(404, { message: "not found" });
      },
    });

    const tool = createNiaExploreTool(client, TEST_CONFIG);
    const result = await tool.execute(
      { source_type: "repository", identifier: "owner/repo" },
      mockContext(),
    );

    expect(treeUrl).toContain("/repositories/r-id/tree");
    expect(result).toContain("file.ts");
  });

  it("uses data-sources endpoint for data_source type", async () => {
    let capturedUrl = "";
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return jsonResponse(200, {
          repository: "docs-site",
          branch: "",
          tree: [{ path: "index.html", type: "file", size: 2048 }],
        });
      },
    });

    const tool = createNiaExploreTool(client, TEST_CONFIG);
    const result = await tool.execute(
      { source_id: "ds-1", source_type: "data_source" },
      mockContext(),
    );

    expect(capturedUrl).toContain("/data-sources/ds-1/tree");
    expect(result).toContain("index.html");
  });

  it("handles empty tree gracefully", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        {
          match: "/repositories/repo-1/tree",
          response: { repository: "r", branch: "main", tree: [] },
        },
      ]),
    });

    const tool = createNiaExploreTool(client, TEST_CONFIG);
    const result = await tool.execute(
      { source_id: "repo-1", source_type: "repository" },
      mockContext(),
    );

    expect(result).toContain("No files found");
  });
});
