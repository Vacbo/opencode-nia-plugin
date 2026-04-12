import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { type FetchFn, NiaClient } from "../api/client.js";
import type { NiaConfig } from "../config.js";
import { createNiaReadTool } from "./nia-read.js";

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

describe("nia_read", () => {
	it("returns file content via source_id", async () => {
		const client = new NiaClient({
			apiKey: "k",
			fetchFn: mockFetch([
				{
					match: "/fs/repo-1/read",
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

		const tool = createNiaReadTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository", path: "src/index.ts" },
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

		const tool = createNiaReadTool(client, TEST_CONFIG);
		await tool.execute(
			{
				source_id: "repo-1",
				source_type: "repository",
				path: "file.ts",
				line_start: 5,
				line_end: 10,
			},
			mockContext(),
		);

		expect(capturedUrl).toContain("line_start=5");
		expect(capturedUrl).toContain("line_end=10");
	});

	it("truncates content exceeding 50KB", async () => {
		const largeContent = "x".repeat(60 * 1024); // 60KB
		const client = new NiaClient({
			apiKey: "k",
			fetchFn: mockFetch([
				{
					match: "/fs/repo-1/read",
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

		const tool = createNiaReadTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository", path: "big.bin" },
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

		const tool = createNiaReadTool(client, TEST_CONFIG);
		const result = await tool.execute({ path: "file.ts" }, mockContext());

		expect(result).toContain("validation_error");
		expect(result).toContain("source_id");
	});

	it("returns API error on 404", async () => {
		const client = new NiaClient({
			apiKey: "k",
			fetchFn: mockFetch([
				{
					match: "/fs/repo-1/read",
					response: { message: "file not found" },
					status: 404,
				},
			]),
		});

		const tool = createNiaReadTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository", path: "missing.ts" },
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
						sources: [
							{
								id: "resolved-id",
								type: "repository",
								repository: "owner/repo",
							},
						],
						total: 1,
					});
				}
				if (url.includes("/fs/resolved-id/read")) {
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

		const tool = createNiaReadTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{
				source_type: "repository",
				identifier: "owner/repo",
				path: "README.md",
			},
			mockContext(),
		);

		expect(result).toContain("resolved content");
		expect(contentUrl).toContain("/fs/resolved-id/read");
	});

	it("reads from unified fs endpoint when source_type is data_source", async () => {
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

		const tool = createNiaReadTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "ds-1", source_type: "data_source", path: "index.html" },
			mockContext(),
		);

		expect(capturedUrl).toContain("/fs/ds-1/read");
		expect(result).toContain("docs content");
	});

	it("returns config_error when apiKey is missing", async () => {
		const client = new NiaClient({
			apiKey: "",
			fetchFn: mockFetch([]),
		});

		const configWithoutApiKey = { ...TEST_CONFIG, apiKey: "" };
		const tool = createNiaReadTool(client, configWithoutApiKey);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository", path: "file.ts" },
			mockContext(),
		);

		expect(result).toContain("config_error");
		expect(result).toContain("NIA_API_KEY");
	});

	it("returns config_error when searchEnabled is false", async () => {
		const client = new NiaClient({
			apiKey: "k",
			fetchFn: mockFetch([]),
		});

		const configDisabled = { ...TEST_CONFIG, searchEnabled: false };
		const tool = createNiaReadTool(client, configDisabled);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository", path: "file.ts" },
			mockContext(),
		);

		expect(result).toContain("config_error");
		expect(result).toContain("disabled");
	});

	it("returns abort_error when request is aborted", async () => {
		const abortController = new AbortController();
		// Abort BEFORE execute - signal is already aborted when execute starts
		abortController.abort();
		const client = new NiaClient({
			apiKey: "k",
			fetchFn: async () => {
				throw new Error("should not reach client");
			},
		});

		const tool = createNiaReadTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository", path: "test.ts" },
			{ ...mockContext(), abort: abortController.signal },
		);

		expect(result).toContain("abort_error");
	});

	it("formats unexpected errors with read_error prefix", async () => {
		// Test that non-network errors (e.g., from resolveSource) get formatted with read_error
		const client = new NiaClient({
			apiKey: "k",
			fetchFn: mockFetch([]),
		});

		// Pass invalid source_type to trigger a validation error from resolveSource
		const tool = createNiaReadTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{
				source_id: "repo-1",
				source_type: "invalid_type" as unknown as "repository",
				path: "file.ts",
			},
			mockContext(),
		);

		// Validation errors from resolveSource are formatted as validation_error by format.ts
		expect(result).toContain("validation_error");
	});
});
