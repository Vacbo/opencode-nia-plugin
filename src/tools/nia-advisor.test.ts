import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import { createNiaAdvisorTool, niaAdvisorArgsSchema } from "./nia-advisor";

type MockClient = {
  post: (path: string, body?: unknown, signal?: AbortSignal) => Promise<unknown>;
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

describe("nia_advisor tool", () => {
  it("formats advisor recommendations as markdown", async () => {
    let capturedPath = "";
    let capturedBody: Record<string, unknown> | undefined;
    let capturedSignal: AbortSignal | undefined;

    const client: MockClient = {
      post: async (path, body, signal) => {
        capturedPath = path;
        capturedBody = body as Record<string, unknown>;
        capturedSignal = signal;

        return {
          id: "adv_1",
          query: "How should I harden this API client?",
          created_at: "2026-03-18T12:00:00Z",
          recommendations: [
            {
              type: "suggestion",
              message: "Add request-scoped retries with exponential backoff.",
              source: "src/api/client.ts",
              confidence: 0.97,
            },
            {
              type: "warning",
              message: "Avoid leaking raw upstream errors to callers.",
              confidence: 0.88,
            },
          ],
        };
      },
    };

    const niaAdvisorTool = createNiaAdvisorTool({
      client,
      config: { apiKey: "nia-key", advisorEnabled: true },
    });
    const args = niaAdvisorArgsSchema.parse({ query: "How should I harden this API client?" });
    const context = createContext();

    const result = await niaAdvisorTool.execute(args, context);

    expect(capturedPath).toBe("/advisor");
    expect(capturedBody).toEqual({ query: "How should I harden this API client?" });
    expect(capturedSignal).toBe(context.abort);
    expect(result).toContain("# Nia Advisor");
    expect(result).toContain("## Recommendations");
    expect(result).toContain("Add request-scoped retries");
    expect(result).toContain("src/api/client.ts");
    expect(result).toContain("97%");
    expect(result).not.toContain('"recommendations"');
  });

  it("forwards optional params and includes them in markdown", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    const niaAdvisorTool = createNiaAdvisorTool({
      client: {
        post: async (_path, body) => {
          capturedBody = body as Record<string, unknown>;

          return {
            id: "adv_2",
            query: "Recommend a refactor plan",
            created_at: "2026-03-18T12:30:00Z",
            recommendations: [
              {
                type: "info",
                message: "Break the tool into request, formatting, and validation modules.",
                source: "src/tools/nia-search.ts",
                confidence: 0.74,
              },
            ],
          };
        },
      },
      config: { apiKey: "nia-key", advisorEnabled: true },
    });

    const result = await niaAdvisorTool.execute(
      niaAdvisorArgsSchema.parse({
        query: "Recommend a refactor plan",
        codebase: "opencode-nia-plugin",
        search_scope: "repo",
        output_format: "markdown",
      }),
      createContext()
    );

    expect(capturedBody).toEqual({
      query: "Recommend a refactor plan",
      codebase: "opencode-nia-plugin",
      search_scope: "repo",
      output_format: "markdown",
    });
    expect(result).toContain("- Codebase: `opencode-nia-plugin`");
    expect(result).toContain("- Search scope: `repo`");
    expect(result).toContain("- Requested output: `markdown`");
  });

  for (const error of [
    "unauthorized [401]: bad key",
    "rate_limited [429]: slow down",
    "server_error [500]: upstream exploded",
  ] as const) {
    it(`returns ${error} without throwing`, async () => {
      const niaAdvisorTool = createNiaAdvisorTool({
        client: {
          post: async () => error,
        },
        config: { apiKey: "nia-key", advisorEnabled: true },
      });

      const result = await niaAdvisorTool.execute(
        niaAdvisorArgsSchema.parse({ query: "What broke?" }),
        createContext()
      );

      expect(result).toBe(error);
    });
  }

  it("returns an abort string when the request signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const niaAdvisorTool = createNiaAdvisorTool({
      client: {
        post: async () => {
          throw new Error("should not reach client");
        },
      },
      config: { apiKey: "nia-key", advisorEnabled: true },
    });

    const result = await niaAdvisorTool.execute(
      niaAdvisorArgsSchema.parse({ query: "cancel me" }),
      createContext(controller.signal)
    );

    expect(result).toBe("abort_error [nia_advisor]: request aborted");
  });
});
