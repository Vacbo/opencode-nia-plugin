import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import { createNiaResearchTool, niaResearchArgsSchema } from "./nia-research";

type MockClient = {
  post: (path: string, body?: unknown, signal?: AbortSignal, timeout?: number) => Promise<unknown>;
  get: (path: string, params?: unknown, signal?: AbortSignal, timeout?: number) => Promise<unknown>;
};

function createContext(signal?: AbortSignal): ToolContext {
  const controller = signal ? undefined : new AbortController();

  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "test",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: signal ?? controller!.signal,
    metadata() {},
    ask: async () => {},
  };
}

describe("nia_research tool", () => {
  it("formats quick mode results as markdown", async () => {
    let capturedPath = "";
    let capturedBody: Record<string, unknown> | undefined;
    let capturedSignal: AbortSignal | undefined;

    const client: MockClient = {
      post: async (path, body, signal) => {
        capturedPath = path;
        capturedBody = body as Record<string, unknown>;
        capturedSignal = signal;

        return {
          query: "best bun test patterns",
          results: [
            {
              title: "Bun test guide",
              url: "https://example.com/bun-test",
              snippet: "Use focused mocks and stable fixtures for fast tests.",
              score: 0.96,
            },
          ],
        };
      },
      get: async () => {
        throw new Error("should not poll quick mode");
      },
    };

    const niaResearchTool = createNiaResearchTool({
      client,
      config: { apiKey: "nia-key", researchEnabled: true },
    });
    const context = createContext();

    const result = await niaResearchTool.execute(
      niaResearchArgsSchema.parse({ query: "best bun test patterns", mode: "quick", num_results: 5 }),
      context
    );

    expect(capturedPath).toBe("/search/web");
    expect(capturedBody).toEqual({ query: "best bun test patterns", num_results: 5 });
    expect(capturedSignal).toBe(context.abort);
    expect(result).toContain("# Nia Research");
    expect(result).toContain("`quick`");
    expect(result).toContain("Bun test guide");
    expect(result).toContain("https://example.com/bun-test");
    expect(result).not.toContain('"results"');
  });

  it("formats deep mode results as markdown", async () => {
    const client: MockClient = {
      post: async () => ({
        id: "deep_1",
        status: "completed",
        result: "Use separate integration and unit suites to keep feedback fast.",
        citations: ["docs/testing.md"],
        sources: [
          {
            id: "src_1",
            source_id: "repo_1",
            source_type: "repository",
            title: "Testing handbook",
            content: "Split slow end-to-end checks from focused unit tests.",
            file_path: "docs/testing.md",
            score: 0.88,
          },
        ],
      }),
      get: async () => {
        throw new Error("should not poll deep mode");
      },
    };

    const niaResearchTool = createNiaResearchTool({
      client,
      config: { apiKey: "nia-key", researchEnabled: true },
    });

    const result = await niaResearchTool.execute(
      niaResearchArgsSchema.parse({ query: "testing strategy", mode: "deep" }),
      createContext()
    );

    expect(result).toContain("`deep`");
    expect(result).toContain("## Result");
    expect(result).toContain("integration and unit suites");
    expect(result).toContain("## Sources");
    expect(result).toContain("docs/testing.md");
    expect(result).toContain("## Citations");
  });

  it("submits oracle jobs and returns the job id immediately", async () => {
    let getCalls = 0;
    let capturedTimeout: number | undefined;

    const client: MockClient = {
      post: async (_path, _body, _signal, timeout) => {
        capturedTimeout = timeout;
        return {
          id: "oracle_job_1",
          status: "pending",
          query: "map the auth flow",
          created_at: "2026-03-18T10:00:00Z",
        };
      },
      get: async () => {
        getCalls += 1;
        return {};
      },
    };

    const niaResearchTool = createNiaResearchTool({
      client,
      config: { apiKey: "nia-key", researchEnabled: true },
    });

    const result = await niaResearchTool.execute(
      niaResearchArgsSchema.parse({ query: "map the auth flow", mode: "oracle" }),
      createContext()
    );

    expect(getCalls).toBe(0);
    expect(capturedTimeout).toBe(60_000);
    expect(result).toContain("oracle_job_1");
    expect(result).toContain("`pending`");
    expect(result).toContain("Re-run this tool with `job_id`");
  });

  it("checks oracle job status when job_id is provided", async () => {
    let capturedPath = "";
    let capturedTimeout: number | undefined;

    const client: MockClient = {
      post: async () => {
        throw new Error("should not create a new oracle job when job_id is provided");
      },
      get: async (path, _params, _signal, timeout) => {
        capturedPath = path;
        capturedTimeout = timeout;
        return {
          id: "oracle_job_2",
          status: "completed",
          query: "explain retries",
          created_at: "2026-03-18T10:00:00Z",
          completed_at: "2026-03-18T10:00:30Z",
          result: "Retry with backoff on 429 and 503 responses.",
        };
      },
    };

    const niaResearchTool = createNiaResearchTool({
      client,
      config: { apiKey: "nia-key", researchEnabled: true },
    });

    const result = await niaResearchTool.execute(
      niaResearchArgsSchema.parse({ mode: "oracle", job_id: "oracle_job_2" }),
      createContext()
    );

    expect(capturedPath).toBe("/oracle/jobs/oracle_job_2");
    expect(capturedTimeout).toBe(60_000);
    expect(result).toContain("`completed`");
    expect(result).toContain("Retry with backoff");
    expect(result).not.toContain('"status"');
  });

  for (const error of ["unauthorized [401]: bad key", "rate_limited [429]: slow down (retry-after=2)"] as const) {
    it(`returns client error strings as-is: ${error}`, async () => {
      const niaResearchTool = createNiaResearchTool({
        client: {
          post: async () => error,
          get: async () => {
            throw new Error("should not poll after a create error");
          },
        },
        config: { apiKey: "nia-key", researchEnabled: true },
      });

      const result = await niaResearchTool.execute(
        niaResearchArgsSchema.parse({ query: "failing research request", mode: "quick" }),
        createContext()
      );

      expect(result).toBe(error);
    });
  }

  it("returns an abort string when the request signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const niaResearchTool = createNiaResearchTool({
      client: {
        post: async () => {
          throw new Error("should not reach client");
        },
        get: async () => {
          throw new Error("should not reach client");
        },
      },
      config: { apiKey: "nia-key", researchEnabled: true },
    });

    const result = await niaResearchTool.execute(
      niaResearchArgsSchema.parse({ query: "cancel me", mode: "quick" }),
      createContext(controller.signal)
    );

    expect(result).toContain("abort_error");
  });
});
