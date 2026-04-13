import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import type { SdkAdapter } from "../api/nia-sdk";
import type { NiaConfig } from "../config";
import { asSdkAdapter } from "../test/sdk-adapter";
import { createNiaTracerTool, niaTracerArgsSchema } from "./nia-tracer";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, sandboxEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, annotationsEnabled: true, bulkDeleteEnabled: true, usageEnabled: true, feedbackEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, apiUrl: "https://apigcp.trynia.ai/v2" } as NiaConfig;

function createContext(signal?: AbortSignal): ToolContext {
  const controller = new AbortController();
  return { sessionID: "session-1", messageID: "message-1", agent: "test", directory: "/tmp/project", worktree: "/tmp/project", abort: signal ?? controller.signal, metadata() {}, ask: async () => {} };
}

describe("nia_tracer tool", () => {
	it("returns inline fast-mode results and forwards timeout settings", async () => {
		let capturedPath = "";
		let capturedBody: Record<string, unknown> | undefined;
		const client = {
			post: async (path: string, body?: unknown) => { capturedPath = path; capturedBody = body as Record<string, unknown>; return { job_id: "job_fast_1", status: "completed", query: "How does streaming work?", result: "Tracer found the streaming coordinator in provider-utils.", results: [{ repository: "vercel/ai", path: "packages/ai/core/generate-text/stream.ts", content: "export async function streamText() {}", line_number: 12, score: 0.98 }] }; },
			get: async () => { throw new Error("should not poll when fast mode returns inline results"); },
		};
		const config = { ...TEST_CONFIG, tracerTimeout: 45 };
		const niaTracerTool = createNiaTracerTool(client as unknown as SdkAdapter, config);
		const result = await niaTracerTool.execute(niaTracerArgsSchema.parse({ query: "How does streaming work?", repositories: ["vercel/ai"] }), createContext());
		expect(capturedPath).toBe("/github/tracer");
		expect(capturedBody).toMatchObject({ query: "How does streaming work?", repositories: ["vercel/ai"], mode: "tracer-fast" });
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
			tracer: {
				streamJob: async function* () { yield { type: "done" as const, data: "done", content: "done" }; },
			},
		};
		const niaTracerTool = createNiaTracerTool(client as unknown as SdkAdapter, TEST_CONFIG);
    const result = await niaTracerTool.execute(niaTracerArgsSchema.parse({ query: "Trace auth refresh flow", tracer_mode: "tracer-deep", repositories: ["acme/app"] }), createContext());
    expect(capturedPath).toBe("/github/tracer");
    expect(capturedBody).toMatchObject({ query: "Trace auth refresh flow", repositories: ["acme/app"], mode: "tracer-deep" });
    expect(result).toContain("job_deep_1");
    expect(result).toContain("Deep tracer analysis started");
    expect(result).toContain("Results will be delivered when complete");
    expect(result).not.toContain("Re-run this tool");
  });

	it("checks an existing tracer job once and reports when it is still running", async () => {
		let calls = 0;
		const client = {
			post: async () => { throw new Error("should not create a new job when job_id is provided"); },
			get: async () => { calls += 1; return { job_id: "job_poll_1", status: "running", query: "Explain retries" }; },
		};
		const config = { ...TEST_CONFIG, tracerTimeout: 5 };
		const niaTracerTool = createNiaTracerTool(client as unknown as SdkAdapter, config);
		const result = await niaTracerTool.execute(niaTracerArgsSchema.parse({ job_id: "job_poll_1" }), createContext());
		expect(calls).toBe(1);
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
		const niaTracerTool = createNiaTracerTool(client as unknown as SdkAdapter, config);
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
		const niaTracerTool = createNiaTracerTool(client as unknown as SdkAdapter, { ...TEST_CONFIG, tracerTimeout: 30 });
    const result = await niaTracerTool.execute(niaTracerArgsSchema.parse({ job_id: "job_abort_1" }), createContext(controller.signal));
    expect(result).toContain("abort_error");
  });

	for (const scenario of [
		{ label: "401", error: new Error("HTTP 401: bad key"), expected: ["tracer_error: HTTP 401: bad key", "Nia API key is invalid or expired"] },
		{ label: "403", error: new Error("HTTP 403: plan required"), expected: ["tracer_error: HTTP 403: plan required"] },
		{ label: "404", error: new Error('HTTP 404: {"message":"job missing"}'), expected: ["tracer_error: HTTP 404", "job missing"] },
		{ label: "429", error: new Error("HTTP 429: slow down"), expected: ["tracer_error: HTTP 429: slow down", "Nia API rate limit hit"] },
		{ label: "500", error: new Error("HTTP 500: upstream exploded"), expected: ["tracer_error: HTTP 500: upstream exploded"] },
	] as const) {
		it(`formats SDK errors for ${scenario.label}`, async () => {
			const niaTracerTool = createNiaTracerTool(
				asSdkAdapter({
					post: async () => {
						throw scenario.error;
					},
					get: async () => {
						throw new Error("should not poll after a create error");
					},
				}),
				TEST_CONFIG,
			);
			const result = await niaTracerTool.execute(
				niaTracerArgsSchema.parse({ query: "trace failures" }),
				createContext(),
			);
			for (const expected of scenario.expected) {
				expect(result).toContain(expected);
			}
		});
	}

  it("returns a validation error when neither query nor job_id is provided", async () => {
		const niaTracerTool = createNiaTracerTool({ post: async () => ({ job_id: "never" }), get: async () => ({ job_id: "never" }) } as unknown as SdkAdapter, TEST_CONFIG);
    const result = await niaTracerTool.execute({ tracer_mode: "tracer-fast" }, createContext());
    expect(result).toContain("validation_error");
    expect(result).toContain("query is required when job_id is not provided");
  });
});
