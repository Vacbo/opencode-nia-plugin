import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import type { SdkAdapter } from "../api/nia-sdk";
import type { NiaConfig } from "../config";
import { asSdkAdapter } from "../test/sdk-adapter";
import { createNiaSandboxTool, niaSandboxArgsSchema } from "./nia-sandbox";

const TEST_CONFIG = {
	apiKey: "nk_test",
	searchEnabled: true,
	sandboxEnabled: true,
	researchEnabled: true,
	tracerEnabled: true,
	advisorEnabled: true,
	contextEnabled: true,
	e2eEnabled: true,
	annotationsEnabled: true,
	bulkDeleteEnabled: true,
	usageEnabled: true,
	feedbackEnabled: true,
	cacheTTL: 300,
	maxPendingOps: 5,
	checkInterval: 15,
	tracerTimeout: 120,
	debug: false,
	triggersEnabled: true,
	apiUrl: "https://apigcp.trynia.ai/v2",
	keywords: { enabled: true, customPatterns: [] },
} as NiaConfig;

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
	} as ToolContext;
}

describe("nia_sandbox tool", () => {
	it("starts a sandbox search job and returns a polling hint", async () => {
		let capturedPath = "";
		let capturedBody: Record<string, unknown> | undefined;

		const client = {
			sandbox: {
				createJob: async (body?: unknown) => {
					capturedPath = "/sandbox/search";
					capturedBody = body as Record<string, unknown>;
					return {
						job_id: "sandbox_job_1",
						status: "queued",
						repository: "https://github.com/vercel/ai",
						ref: "main",
						query: "streamText",
					};
				},
				getJob: async () => {
					throw new Error("should not poll when creating sandbox job");
				},
				streamJob: async function* () {
					yield { type: "done", data: "sandbox finished" };
				},
			},
		};

		const tool = createNiaSandboxTool(client as unknown as SdkAdapter, TEST_CONFIG);
		const result = await tool.execute(
			niaSandboxArgsSchema.parse({
				repository: "https://github.com/vercel/ai",
				query: "streamText",
			}),
			createContext(),
		);

		expect(capturedPath).toBe("/sandbox/search");
		expect(capturedBody).toMatchObject({
			repository: "https://github.com/vercel/ai",
			ref: "main",
			query: "streamText",
		});
		expect(result).toContain("# Nia Sandbox");
		expect(result).toContain("sandbox_job_1");
		expect(result).toContain("queued");
		expect(result).toContain("Re-run this tool with `job_id`");
	});

	it("returns completed sandbox results from a status check", async () => {
		let calls = 0;
		const client = {
			sandbox: {
				createJob: async () => {
					throw new Error(
						"should not create a new job when job_id is provided",
					);
				},
				getJob: async () => {
					calls += 1;
					return {
						job_id: "sandbox_job_2",
						status: "completed",
						repository: "https://github.com/vercel/ai",
						ref: "main",
						query: "streamText",
						result: "Found streamText in the core generation pipeline.",
						results: [
							{
								path: "packages/ai/core/generate-text/stream-text.ts",
								content: "export async function streamText() {}",
								line_number: 18,
								score: 0.97,
							},
						],
					};
				},
				streamJob: async function* () {},
			},
		};

		const tool = createNiaSandboxTool(client as unknown as SdkAdapter, TEST_CONFIG);
		const result = await tool.execute(
			niaSandboxArgsSchema.parse({ job_id: "sandbox_job_2" }),
			createContext(),
		);

		expect(calls).toBe(1);
		expect(result).toContain("sandbox_job_2");
		expect(result).toContain("completed");
		expect(result).toContain("streamText in the core generation pipeline");
		expect(result).toContain(
			"packages/ai/core/generate-text/stream-text.ts:18",
		);
	});

	it("returns a validation error when repository is missing for a new search", async () => {
		const tool = createNiaSandboxTool(
			asSdkAdapter({
				sandbox: {
					createJob: async () => ({ job_id: "never" }),
					getJob: async () => ({ job_id: "never" }),
					streamJob: async function* () {},
				},
			}),
			TEST_CONFIG,
		);

		const result = await tool.execute(
			{ ref: "main", query: "streamText" },
			createContext(),
		);

		expect(result).toContain("validation_error");
		expect(result).toContain(
			"repository is required when job_id is not provided",
		);
	});

	it("formats auth failures from the sandbox endpoint", async () => {
		const tool = createNiaSandboxTool(
			asSdkAdapter({
				sandbox: {
					createJob: async () => {
						throw new Error("HTTP 401: bad key");
					},
					getJob: async () => {
						throw new Error("should not poll after a create error");
					},
					streamJob: async function* () {},
				},
			}),
			TEST_CONFIG,
		);

		const result = await tool.execute(
			niaSandboxArgsSchema.parse({
				repository: "https://github.com/vercel/ai",
				query: "streamText",
			}),
			createContext(),
		);

		expect(result).toContain("sandbox_error: HTTP 401: bad key");
		expect(result).toContain("Nia API key is invalid or expired");
	});
});
