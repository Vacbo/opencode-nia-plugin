import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import type { NiaClient } from "../api/client";
import type { NiaConfig } from "../config";
import { createNiaTracerTool, niaTracerArgsSchema } from "./nia-tracer";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] } } as NiaConfig;

function createContext(signal?: AbortSignal): ToolContext {
  const controller = new AbortController();
  return { sessionID: "session-1", messageID: "message-1", agent: "test", directory: "/tmp/project", worktree: "/tmp/project", abort: signal ?? controller.signal, metadata() {}, ask: async () => {} };
}

describe("nia_tracer tool", () => {
  it("returns inline fast-mode results and forwards timeout settings", async () => {
    let capturedPath = "";
    let capturedBody: Record<string, unknown> | undefined;
    let capturedTimeout: number | undefined;
    const client = {
      post: async (path: string, body?: unknown, _signal?: AbortSignal, timeout?: number) => { capturedPath = path; capturedBody = body as Record<string, unknown>; capturedTimeout = timeout; return { job_id: "job_fast_1", status: "completed", query: "How does streaming work?", result: "Tracer found the streaming coordinator in provider-utils.", results: [{ repository: "vercel/ai", path: "packages/ai/core/generate-text/stream.ts", content: "export async function streamText() {}", line_number: 12, score: 0.98 }] }; },
      get: async () => { throw new Error("should not poll when fast mode returns inline results"); },
    };
    const config = { ...TEST_CONFIG, tracerTimeout: 45 };
    const niaTracerTool = createNiaTracerTool(client as unknown as NiaClient, config);
    const result = await niaTracerTool.execute(niaTracerArgsSchema.parse({ query: "How does streaming work?", repositories: ["vercel/ai"] }), createContext());
    expect(capturedPath).toBe("/github/tracer");
    expect(capturedBody).toMatchObject({ query: "How does streaming work?", repositories: ["vercel/ai"], mode: "tracer-fast" });
    expect(capturedTimeout).toBe(45_000);
    expect(result).toContain("# Nia Tracer");
    expect(result).toContain("tracer-fast");
    expect(result).toContain("completed");
    expect(result).toContain("provider-utils");
    expect(result).toContain("packages/ai/core/generate-text/stream.ts:12");
  });

  it("submits deep-mode jobs via NiaJobManager and returns immediately (fire-and-forget)", async () => {
    let capturedPath = "";
    let capturedBody: Record<string, unknown> | undefined;
    const client = {
      post: async (path: string, body?: unknown) => { capturedPath = path; capturedBody = body as Record<string, unknown>; return { job_id: "job_deep_1", status: "queued", query: "Trace auth refresh flow" }; },
      get: async () => { throw new Error("should not poll when deep mode fires and forgets"); },
      stream: async function* () { yield { type: "done" as const, data: "done", content: "done" }; },
    };
    const niaTracerTool = createNiaTracerTool(client as unknown as NiaClient, TEST_CONFIG);
    const result = await niaTracerTool.execute(niaTracerArgsSchema.parse({ query: "Trace auth refresh flow", tracer_mode: "tracer-deep", repositories: ["acme/app"] }), createContext());
    expect(capturedPath).toBe("/github/tracer/jobs");
    expect(capturedBody).toMatchObject({ query: "Trace auth refresh flow", repositories: ["acme/app"], mode: "tracer-deep" });
    expect(result).toContain("job_deep_1");
    expect(result).toContain("Deep tracer analysis started");
    expect(result).toContain("Results will be delivered when complete");
    expect(result).not.toContain("Re-run this tool");
  });

  it("checks an existing tracer job once and reports when it is still running", async () => {
    const capturedTimeouts: number[] = [];
    let calls = 0;
    const client = {
      post: async () => { throw new Error("should not create a new job when job_id is provided"); },
      get: async (_path: string, _params?: unknown, _signal?: AbortSignal, timeout?: number) => { capturedTimeouts.push(timeout ?? 0); calls += 1; return { job_id: "job_poll_1", status: "running", query: "Explain retries" }; },
    };
    const config = { ...TEST_CONFIG, tracerTimeout: 5 };
    const niaTracerTool = createNiaTracerTool(client as unknown as NiaClient, config);
    const result = await niaTracerTool.execute(niaTracerArgsSchema.parse({ job_id: "job_poll_1" }), createContext());
    expect(calls).toBe(1);
    expect(capturedTimeouts).toEqual([5_000]);
    expect(result).toContain("job_poll_1");
    expect(result).toContain("running");
    expect(result).toContain("still `running`");
  });

  it("returns completed results from a single job status check", async () => {
    let calls = 0;
    const client = {
      post: async () => { throw new Error("should not create a new job when job_id is provided"); },
      get: async () => { calls += 1; return { job_id: "job_poll_1", status: "completed", query: "Explain retries", result: "Retry logic backs off on 429 and 503 responses." }; },
    };
    const config = { ...TEST_CONFIG, tracerTimeout: 5 };
    const niaTracerTool = createNiaTracerTool(client as unknown as NiaClient, config);
    const result = await niaTracerTool.execute(niaTracerArgsSchema.parse({ job_id: "job_poll_1" }), createContext());
    expect(calls).toBe(1);
    expect(result).toContain("job_poll_1");
    expect(result).toContain("completed");
    expect(result).toContain("Retry logic backs off");
  });

  it("returns abort_error when a single status check is aborted", async () => {
    const controller = new AbortController();
    const client = {
      post: async () => { throw new Error("should not create a new job when checking status"); },
      get: async () => { controller.abort(); throw new DOMException("Aborted", "AbortError"); },
    };
    const niaTracerTool = createNiaTracerTool(client as unknown as NiaClient, { ...TEST_CONFIG, tracerTimeout: 30 });
    const result = await niaTracerTool.execute(niaTracerArgsSchema.parse({ job_id: "job_abort_1" }), createContext(controller.signal));
    expect(result).toContain("abort_error");
  });

  for (const error of ["unauthorized [401]: bad key", "forbidden [403]: plan required", "not_found [404]: job missing", "rate_limited [429]: slow down (retry-after=1)", "server_error [500]: upstream exploded"] as const) {
    it(`returns client error strings as-is: ${error}`, async () => {
      const niaTracerTool = createNiaTracerTool({ post: async () => error, get: async () => { throw new Error("should not poll after a create error"); } } as unknown as NiaClient, TEST_CONFIG);
      const result = await niaTracerTool.execute(niaTracerArgsSchema.parse({ query: "trace failures" }), createContext());
      expect(result).toBe(error);
    });
  }

  it("returns a validation error when neither query nor job_id is provided", async () => {
    const niaTracerTool = createNiaTracerTool({ post: async () => ({ job_id: "never" }), get: async () => ({ job_id: "never" }) } as unknown as NiaClient, TEST_CONFIG);
    const result = await niaTracerTool.execute({ tracer_mode: "tracer-fast" }, createContext());
    expect(result).toContain("validation_error");
    expect(result).toContain("query is required when job_id is not provided");
  });
});
