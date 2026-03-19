import { describe, expect, it } from "bun:test";

import { NiaClient, type FetchFn } from "../api/client.js";
import type { ToolContext } from "@opencode-ai/plugin";
import { createNiaGrepTool } from "./nia-grep.js";

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

describe("nia_grep", () => {
  it("returns formatted grep matches", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        {
          match: "/repositories/repo-1/grep",
          response: [
            { path: "src/app.ts", line_number: 10, content: "const foo = bar;" },
            { path: "src/util.ts", line_number: 25, content: "let foo = baz;" },
          ],
        },
      ]),
    });

    const tool = createNiaGrepTool(client);
    const result = await tool.execute(
      { source_id: "repo-1", pattern: "foo" },
      mockContext(),
    );

    expect(result).toContain("Grep: `foo`");
    expect(result).toContain("Matches:** 2");
    expect(result).toContain("src/app.ts:10");
    expect(result).toContain("const foo = bar;");
    expect(result).toContain("src/util.ts:25");
  });

  it("truncates results exceeding 100 matches", async () => {
    const matches = Array.from({ length: 150 }, (_, i) => ({
      path: `file${i}.ts`,
      line_number: i + 1,
      content: `match ${i}`,
    }));

    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        { match: "/repositories/repo-1/grep", response: matches },
      ]),
    });

    const tool = createNiaGrepTool(client);
    const result = await tool.execute(
      { source_id: "repo-1", pattern: "match" },
      mockContext(),
    );

    expect(result).toContain("150");
    expect(result).toContain("showing first 100");
    expect(result).toContain("file0.ts:1");
    expect(result).toContain("file99.ts:100");
    expect(result).not.toContain("file100.ts");
  });

  it("passes context_lines and case_sensitive in POST body", async () => {
    let capturedBody = "";
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = String(init.body);
        }
        return jsonResponse(200, [
          { path: "a.ts", line_number: 1, content: "hit" },
        ]);
      },
    });

    const tool = createNiaGrepTool(client);
    await tool.execute(
      {
        source_id: "repo-1",
        pattern: "hit",
        context_lines: 3,
        case_sensitive: false,
      },
      mockContext(),
    );

    const body = JSON.parse(capturedBody);
    expect(body.context_lines).toBe(3);
    expect(body.case_sensitive).toBe(false);
    expect(body.pattern).toBe("hit");
  });

  it("returns API error on failure", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        {
          match: "/repositories/repo-1/grep",
          response: { message: "internal error" },
          status: 500,
        },
      ]),
    });

    const tool = createNiaGrepTool(client);
    const result = await tool.execute(
      { source_id: "repo-1", pattern: "foo" },
      mockContext(),
    );

    expect(result).toContain("server_error");
    expect(result).toContain("500");
  });

  it("returns no-matches message for empty results", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        { match: "/repositories/repo-1/grep", response: [] },
      ]),
    });

    const tool = createNiaGrepTool(client);
    const result = await tool.execute(
      { source_id: "repo-1", pattern: "nonexistent" },
      mockContext(),
    );

    expect(result).toContain("No matches");
    expect(result).toContain("nonexistent");
  });

  it("resolves source via source_type + identifier", async () => {
    let grepUrl = "";
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
        if (url.includes("/repositories/r-id/grep")) {
          grepUrl = url;
          return jsonResponse(200, [
            { path: "a.ts", line_number: 1, content: "found" },
          ]);
        }
        return jsonResponse(404, { message: "not found" });
      },
    });

    const tool = createNiaGrepTool(client);
    const result = await tool.execute(
      { source_type: "repository", identifier: "owner/repo", pattern: "found" },
      mockContext(),
    );

    expect(grepUrl).toContain("/repositories/r-id/grep");
    expect(result).toContain("found");
  });
});
