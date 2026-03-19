import { describe, expect, it } from "bun:test";

import { NiaClient, type FetchFn } from "../api/client.js";
import type { ToolContext } from "@opencode-ai/plugin";
import { createNiaReadTool } from "./nia-read.js";

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

describe("nia_read", () => {
  it("returns file content via source_id", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        {
          match: "/repositories/repo-1/content",
          response: {
            content: "const x = 1;\nconst y = 2;",
            path: "src/index.ts",
            size: 26,
            line_count: 2,
            encoding: "utf-8",
          },
        },
      ]),
    });

    const tool = createNiaReadTool(client);
    const result = await tool.execute(
      { source_id: "repo-1", path: "src/index.ts" },
      mockContext(),
    );

    expect(result).toContain("src/index.ts");
    expect(result).toContain("const x = 1;");
    expect(result).toContain("const y = 2;");
    expect(result).toContain("26 bytes");
    expect(result).toContain("Lines:** 2");
  });

  it("passes line_start and line_end as query params", async () => {
    let capturedUrl = "";
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return jsonResponse(200, {
          content: "line 5 content",
          path: "file.ts",
          size: 14,
          line_count: 10,
          encoding: "utf-8",
        });
      },
    });

    const tool = createNiaReadTool(client);
    await tool.execute(
      { source_id: "repo-1", path: "file.ts", line_start: 5, line_end: 10 },
      mockContext(),
    );

    expect(capturedUrl).toContain("start_line=5");
    expect(capturedUrl).toContain("end_line=10");
  });

  it("truncates content exceeding 50KB", async () => {
    const largeContent = "x".repeat(60 * 1024); // 60KB
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        {
          match: "/repositories/repo-1/content",
          response: {
            content: largeContent,
            path: "big.bin",
            size: 60 * 1024,
            line_count: 1,
            encoding: "utf-8",
          },
        },
      ]),
    });

    const tool = createNiaReadTool(client);
    const result = await tool.execute(
      { source_id: "repo-1", path: "big.bin" },
      mockContext(),
    );

    expect(result).toContain("Truncated");
    expect(result).toContain("50KB");
    expect(result.length).toBeLessThan(largeContent.length);
  });

  it("returns validation error when neither source_id nor identifier given", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([]),
    });

    const tool = createNiaReadTool(client);
    const result = await tool.execute({ path: "file.ts" }, mockContext());

    expect(result).toContain("validation_error");
    expect(result).toContain("source_id");
  });

  it("returns API error on 404", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        {
          match: "/repositories/repo-1/content",
          response: { message: "file not found" },
          status: 404,
        },
      ]),
    });

    const tool = createNiaReadTool(client);
    const result = await tool.execute(
      { source_id: "repo-1", path: "missing.ts" },
      mockContext(),
    );

    expect(result).toContain("not_found");
    expect(result).toContain("404");
  });

  it("resolves source via source_type + identifier", async () => {
    let contentUrl = "";
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/sources")) {
          return jsonResponse(200, {
            sources: [{ id: "resolved-id", type: "repository", repository: "owner/repo" }],
            total: 1,
          });
        }
        if (url.includes("/repositories/resolved-id/content")) {
          contentUrl = url;
          return jsonResponse(200, {
            content: "resolved content",
            path: "README.md",
            size: 16,
            line_count: 1,
            encoding: "utf-8",
          });
        }
        return jsonResponse(404, { message: "not found" });
      },
    });

    const tool = createNiaReadTool(client);
    const result = await tool.execute(
      { source_type: "repository", identifier: "owner/repo", path: "README.md" },
      mockContext(),
    );

    expect(result).toContain("resolved content");
    expect(contentUrl).toContain("/repositories/resolved-id/content");
  });

  it("reads from data_source endpoint when source_type is data_source", async () => {
    let capturedUrl = "";
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return jsonResponse(200, {
          content: "docs content",
          path: "index.html",
          size: 12,
          line_count: 1,
          encoding: "utf-8",
        });
      },
    });

    const tool = createNiaReadTool(client);
    const result = await tool.execute(
      { source_id: "ds-1", source_type: "data_source", path: "index.html" },
      mockContext(),
    );

    expect(capturedUrl).toContain("/data-sources/ds-1/content");
    expect(result).toContain("docs content");
  });
});
