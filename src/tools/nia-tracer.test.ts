import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import { createNiaTracerTool, niaTracerArgsSchema } from "./nia-tracer";

type MockClient = {
  post: (path: string, body?: unknown, signal?: AbortSignal, timeout?: number) => Promise<unknown>;
  get: (path: string, params?: unknown, signal?: AbortSignal, timeout?: number) => Promise<unknown>;
  delete?: (path: string, body?: unknown, signal?: AbortSignal, timeout?: number) => Promise<unknown>;
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

describe("nia_tracer tool", () => {
  it("returns inline fast-mode results and forwards timeout settings", async () => {
    let capturedPath = "";
    let capturedBody: Record<string, unknown> | undefined;
    let capturedSignal: AbortSignal | undefined;
    let capturedTimeout: number | undefined;

    const client: MockClient = {
      post: async (path, body, signal, timeout) => {
        capturedPath = path;
        capturedBody = body as Record<string, unknown>;
        capturedSignal = signal;
        capturedTimeout = timeout;

        return {
          job_id: "job_fast_1",
          status: "completed",
          query: "How does streaming work?",
          result: "Tracer found the streaming coordinator in provider-utils.",
          results: [
            {
              repository: "vercel/ai",
              path: "packages/ai/core/generate-text/stream.ts",
              content: "export async function streamText() {}",
              line_number: 12,
              score: 0.98,
            },
          ],
        };
      },
      get: async () => {
        throw new Error("should not poll when fast mode returns inline results");
      },
    };

    const niaTracerTool = createNiaTracerTool({
      client,
      config: { apiKey: "nia-key", tracerEnabled: true, tracerTimeout: 45, checkInterval: 0 },
    });
    const context = createContext();

    const result = await niaTracerTool.execute(
      niaTracerArgsSchema.parse({
        query: "How does streaming work?",
        repositories: ["vercel/ai"],
      }),
      context
    );

    expect(capturedPath).toBe("/github/tracer");
    expect(capturedBody).toMatchObject({
      query: "How does streaming work?",
      repositories: ["vercel/ai"],
      mode: "tracer-fast",
    });
    expect(capturedSignal).toBe(context.abort);
    expect(capturedTimeout).toBe(45_000);
    expect(result).toContain("# Nia Tracer");
    expect(result).toContain("tracer-fast");
    expect(result).toContain("completed");
    expect(result).toContain("provider-utils");
    expect(result).toContain("packages/ai/core/generate-text/stream.ts:12");
  });

  it("starts deep-mode jobs without polling and returns the job id immediately", async () => {
    let getCalls = 0;

    const client: MockClient = {
      post: async () => ({
        job_id: "job_deep_1",
        status: "queued",
        query: "Trace auth refresh flow",
      }),
      get: async () => {
        getCalls += 1;
        return {};
      },
    };

    const niaTracerTool = createNiaTracerTool({
      client,
      config: { apiKey: "nia-key", tracerEnabled: true, tracerTimeout: 120, checkInterval: 0 },
    });

    const result = await niaTracerTool.execute(
      niaTracerArgsSchema.parse({
        query: "Trace auth refresh flow",
        tracer_mode: "tracer-deep",
        repositories: ["acme/app"],
      }),
      createContext()
    );

    expect(getCalls).toBe(0);
    expect(result).toContain("job_deep_1");
    expect(result).toContain("queued");
    expect(result).toContain("Re-run this tool with `job_id`");
  });

  it("polls an existing tracer job until completion", async () => {
    let capturedTimeouts: number[] = [];
    let calls = 0;

    const client: MockClient = {
      post: async () => {
        throw new Error("should not create a new job when job_id is provided");
      },
      get: async (_path, _params, signal, timeout) => {
        capturedTimeouts.push(timeout ?? 0);
        expect(signal).toBeDefined();
        calls += 1;

        if (calls === 1) {
          return {
            job_id: "job_poll_1",
            status: "running",
            query: "Explain retries",
          };
        }

        return {
          job_id: "job_poll_1",
          status: "completed",
          query: "Explain retries",
          result: "Retry logic backs off on 429 and 503 responses.",
        };
      },
    };

    const niaTracerTool = createNiaTracerTool({
      client,
      config: { apiKey: "nia-key", tracerEnabled: true, tracerTimeout: 5, checkInterval: 0 },
    });

    const result = await niaTracerTool.execute(
      niaTracerArgsSchema.parse({ job_id: "job_poll_1" }),
      createContext()
    );

    expect(calls).toBe(2);
    expect(capturedTimeouts).toEqual([5_000, 5_000]);
    expect(result).toContain("job_poll_1");
    expect(result).toContain("completed");
    expect(result).toContain("Retry logic backs off");
  });

  it("cancels the server-side job when polling is aborted", async () => {
    const controller = new AbortController();
    const deleteCalls: Array<{ path: string; signal: AbortSignal | undefined; timeout: number | undefined }> = [];

    const client: MockClient = {
      post: async () => {
        throw new Error("should not create a new job when polling");
      },
      get: async () => {
        controller.abort();
        return {
          job_id: "job_abort_1",
          status: "running",
          query: "Trace cancellation",
        };
      },
      delete: async (path, _body, signal, timeout) => {
        deleteCalls.push({ path, signal, timeout });
        return { deleted: true };
      },
    };

    const niaTracerTool = createNiaTracerTool({
      client,
      config: { apiKey: "nia-key", tracerEnabled: true, tracerTimeout: 30, checkInterval: 1 },
    });

    const result = await niaTracerTool.execute(
      niaTracerArgsSchema.parse({ job_id: "job_abort_1" }),
      createContext(controller.signal)
    );

    expect(result).toContain("abort_error");
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toMatchObject({ path: "/github/tracer/job_abort_1", timeout: 10_000 });
    expect(deleteCalls[0]?.signal).toBeUndefined();
  });

  for (const error of [
    "unauthorized [401]: bad key",
    "forbidden [403]: plan required",
    "not_found [404]: job missing",
    "rate_limited [429]: slow down (retry-after=1)",
    "server_error [500]: upstream exploded",
  ] as const) {
    it(`returns client error strings as-is: ${error}`, async () => {
      const niaTracerTool = createNiaTracerTool({
        client: {
          post: async () => error,
          get: async () => {
            throw new Error("should not poll after a create error");
          },
        },
        config: { apiKey: "nia-key", tracerEnabled: true },
      });

      const result = await niaTracerTool.execute(
        niaTracerArgsSchema.parse({ query: "trace failures" }),
        createContext()
      );

      expect(result).toBe(error);
    });
  }

  it("returns a validation error when neither query nor job_id is provided", async () => {
    const niaTracerTool = createNiaTracerTool({
      client: {
        post: async () => ({ job_id: "never" }),
        get: async () => ({ job_id: "never" }),
      },
      config: { apiKey: "nia-key", tracerEnabled: true },
    });

    const result = await niaTracerTool.execute({ tracer_mode: "tracer-fast" }, createContext());

    expect(result).toContain("validation_error");
    expect(result).toContain("query is required when job_id is not provided");
  });
});
