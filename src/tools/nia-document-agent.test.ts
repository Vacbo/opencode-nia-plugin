import { afterEach, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import type { SdkAdapter } from "../api/nia-sdk";
import type { NiaConfig } from "../config";
import { jobManager } from "../state/job-manager";
import { createNiaDocumentAgentTool } from "./nia-document-agent";

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
	documentAgentEnabled: true,
	cacheTTL: 300,
	maxPendingOps: 5,
	checkInterval: 15,
	tracerTimeout: 120,
	debug: false,
	apiUrl: "https://apigcp.trynia.ai/v2",
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
		ask: async () => undefined,
	} as unknown as ToolContext;
}

afterEach(() => {
	jobManager.clearJobs();
});

describe("nia_document_agent tool", () => {
	it("runs synchronous PDF analysis and formats citations", async () => {
		let capturedBody: Record<string, unknown> | undefined;

		const client = {
			documentAgent: {
				query: async (body: unknown) => {
					capturedBody = body as Record<string, unknown>;
					return {
						answer:
							"The paper replaces recurrence with attention-only sequence modeling.",
						model: "claude-opus-4-6-1m",
						structured_output: { summary: "attention-only architecture" },
						usage: { input_tokens: 123, output_tokens: 456 },
						citations: [
							{
								content: "We propose a new simple network architecture, the Transformer.",
								page_number: 1,
								section_title: "Abstract",
								tool_source: "read_page",
								source_id: "paper_1",
								source_name: "Attention Is All You Need",
							},
						],
					};
				},
				createJob: async () => ({ job_id: "unused" }),
				getJob: async () => ({ job_id: "unused" }),
				streamJob: async function* () {},
				deleteJob: async () => ({ status: "cancelled" }),
			},
		} as unknown as SdkAdapter;

		const documentTool = createNiaDocumentAgentTool(client, TEST_CONFIG);
		const result = await documentTool.execute(
			{
				action: "sync",
				source_id: "paper_1",
				query: "What is the main contribution?",
			},
			createContext(),
		);

		expect(capturedBody).toMatchObject({
			source_id: "paper_1",
			query: "What is the main contribution?",
		});
		expect(result).toContain("# Nia Document Agent");
		expect(result).toContain("- Action: `sync`");
		expect(result).toContain("## Answer");
		expect(result).toContain("attention-only sequence modeling");
		expect(result).toContain("## Citations");
		expect(result).toContain("Attention Is All You Need");
		expect(result).toContain("Page: `1`");
	});

	it("submits an async document agent job and returns the job id", async () => {
		let capturedBody: Record<string, unknown> | undefined;

		const client = {
			documentAgent: {
				query: async () => ({ answer: "unused", model: "unused" }),
				createJob: async (body: unknown) => {
					capturedBody = body as Record<string, unknown>;
					return {
						job_id: "doc_job_1",
						status: "queued",
						created_at: "2026-04-12T00:00:00Z",
						message: "queued",
					};
				},
				getJob: async () => ({ job_id: "unused" }),
				streamJob: async function* () {
					yield { type: "done", data: "finished" };
				},
				deleteJob: async () => ({ status: "cancelled" }),
			},
		} as unknown as SdkAdapter;

		const documentTool = createNiaDocumentAgentTool(client, TEST_CONFIG);
		const result = await documentTool.execute(
			{
				action: "async_submit",
				source_ids: ["paper_1", "paper_2"],
				query: "Compare the findings.",
			},
			createContext(),
		);

		expect(capturedBody).toMatchObject({
			source_ids: ["paper_1", "paper_2"],
			query: "Compare the findings.",
		});
		expect(result).toContain("doc_job_1");
		expect(result).toContain("queued");
		expect(result).toContain("Results will be delivered when complete");
	});

	it("polls async document agent job status and formats completed output", async () => {
		let capturedJobId = "";

		const client = {
			documentAgent: {
				query: async () => ({ answer: "unused", model: "unused" }),
				createJob: async () => ({ job_id: "unused" }),
				getJob: async (jobId: string) => {
					capturedJobId = jobId;
					return {
						job_id: jobId,
						status: "completed",
						answer: "Section 3 introduces the scaling law.",
						model: "claude-opus-4-6-1m",
						citations: [
							{
								content: "Scaling improves translation quality.",
								page_number: 5,
								section_title: "Results",
								tool_source: "search_sections",
							},
						],
					};
				},
				streamJob: async function* () {},
				deleteJob: async () => ({ status: "cancelled" }),
			},
		} as unknown as SdkAdapter;

		const documentTool = createNiaDocumentAgentTool(client, TEST_CONFIG);
		const result = await documentTool.execute(
			{ action: "async_status", job_id: "doc_job_2" },
			createContext(),
		);

		expect(capturedJobId).toBe("doc_job_2");
		expect(result).toContain("doc_job_2");
		expect(result).toContain("completed");
		expect(result).toContain("Section 3 introduces the scaling law");
		expect(result).toContain("## Citations");
	});

	it("starts SSE streaming for an existing document agent job", async () => {
		let streamedJobId = "";

		const client = {
			documentAgent: {
				query: async () => ({ answer: "unused", model: "unused" }),
				createJob: async () => ({ job_id: "unused" }),
				getJob: async () => ({ job_id: "unused" }),
				streamJob: async function* (jobId: string) {
					streamedJobId = jobId;
					yield { type: "done", data: "finished" };
				},
				deleteJob: async () => ({ status: "cancelled" }),
			},
		} as unknown as SdkAdapter;

		const documentTool = createNiaDocumentAgentTool(client, TEST_CONFIG);
		const result = await documentTool.execute(
			{ action: "async_stream", job_id: "doc_job_3" },
			createContext(),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(streamedJobId).toBe("doc_job_3");
		expect(result).toContain("doc_job_3");
		expect(result).toContain("Streaming document agent job");
	});

	it("cancels an async document agent job", async () => {
		let deletedJobId = "";

		const client = {
			documentAgent: {
				query: async () => ({ answer: "unused", model: "unused" }),
				createJob: async () => ({ job_id: "unused" }),
				getJob: async () => ({ job_id: "unused" }),
				streamJob: async function* () {},
				deleteJob: async (jobId: string) => {
					deletedJobId = jobId;
					return { status: "cancelled", job_id: jobId };
				},
			},
		} as unknown as SdkAdapter;

		const documentTool = createNiaDocumentAgentTool(client, TEST_CONFIG);
		const result = await documentTool.execute(
			{ action: "async_delete", job_id: "doc_job_4" },
			createContext(),
		);

		expect(deletedJobId).toBe("doc_job_4");
		expect(result).toContain("doc_job_4");
		expect(result).toContain("cancelled");
	});

	it("returns a validation error when source ids and query are missing", async () => {
		const client = {
			documentAgent: {
				query: async () => ({ answer: "unused", model: "unused" }),
				createJob: async () => ({ job_id: "unused" }),
				getJob: async () => ({ job_id: "unused" }),
				streamJob: async function* () {},
				deleteJob: async () => ({ status: "cancelled" }),
			},
		} as unknown as SdkAdapter;

		const documentTool = createNiaDocumentAgentTool(client, TEST_CONFIG);
		const result = await documentTool.execute(
			{ action: "sync" },
			createContext(),
		);

		expect(result).toContain("validation_error");
		expect(result).toContain("query is required");
		expect(result).toContain("source_id or source_ids is required");
	});

	it("formats auth failures from the document agent endpoint", async () => {
		const client = {
			documentAgent: {
				query: async () => {
					throw new Error("HTTP 401: bad key");
				},
				createJob: async () => ({ job_id: "unused" }),
				getJob: async () => ({ job_id: "unused" }),
				streamJob: async function* () {},
				deleteJob: async () => ({ status: "cancelled" }),
			},
		} as unknown as SdkAdapter;

		const documentTool = createNiaDocumentAgentTool(client, TEST_CONFIG);
		const result = await documentTool.execute(
			{
				action: "sync",
				source_id: "paper_1",
				query: "What is the main contribution?",
			},
			createContext(),
		);

		expect(result).toContain("document_agent_error: HTTP 401: bad key");
		expect(result).toContain("Nia API key is invalid or expired");
	});

	it("is wired into the plugin registry and README", async () => {
		const indexSource = await Bun.file(new URL("../index.ts", import.meta.url)).text();
		const readme = await Bun.file(new URL("../../README.md", import.meta.url)).text();

		expect(indexSource).toContain("createNiaDocumentAgentTool");
		expect(indexSource).toContain("nia_document_agent");
		expect(readme).toContain("nia_document_agent");
	});
});
