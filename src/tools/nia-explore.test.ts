import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import {
	asSdkAdapter,
	createMatchedResponseHandler,
	createResponseSdkAdapter,
} from "../test/sdk-adapter.js";
import type { NiaConfig } from "../config.js";
import { createNiaExploreTool } from "./nia-explore.js";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, sandboxEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, annotationsEnabled: true, bulkDeleteEnabled: true, usageEnabled: true, feedbackEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, apiUrl: "https://apigcp.trynia.ai/v2" } as NiaConfig;

function jsonResponse(status: number, body?: unknown): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function createClient(
	handlers: Array<{ match: string; response: unknown; status?: number }>,
) {
	return createResponseSdkAdapter(createMatchedResponseHandler(handlers));
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

describe("nia_explore", () => {
	it("returns formatted tree for a repository", async () => {
		const client = createClient([
			{
				match: "/fs/repo-1/tree",
				response: {
					repository: "owner/repo",
					branch: "main",
					tree: [
						{ path: "src", type: "directory" },
						{ path: "README.md", type: "file", size: 1024 },
					],
				},
			},
		]);

		const tool = createNiaExploreTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository" },
			mockContext(),
		);

		expect(result).toContain("owner/repo");
		expect(result).toContain("main");
		expect(result).toContain("src");
		expect(result).toContain("README.md");
		expect(result).toContain("1024");
	});

	it("renders nested directory tree with children", async () => {
		const client = createClient([
			{
				match: "/fs/repo-1/tree",
				response: {
					repository: "owner/repo",
					branch: "main",
					tree: [
						{
							path: "src",
							type: "directory",
							children: [
								{ path: "index.ts", type: "file", size: 200 },
								{
									path: "utils",
									type: "directory",
									children: [{ path: "helper.ts", type: "file", size: 50 }],
								},
							],
						},
					],
				},
			},
		]);

		const tool = createNiaExploreTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository" },
			mockContext(),
		);

		expect(result).toContain("src");
		expect(result).toContain("index.ts");
		expect(result).toContain("utils");
		expect(result).toContain("helper.ts");
		const srcIdx = result.indexOf("src");
		const indexIdx = result.indexOf("index.ts");
		expect(indexIdx).toBeGreaterThan(srcIdx);
	});

	it("passes path and max_depth as query params", async () => {
		let capturedUrl = "";
		const client = createResponseSdkAdapter(async (url) => {
				capturedUrl = String(url);
				return jsonResponse(200, {
					repository: "r",
					branch: "main",
					tree: [{ path: "sub/file.ts", type: "file", size: 10 }],
				});
			});

		const tool = createNiaExploreTool(client, TEST_CONFIG);
		await tool.execute(
			{
				source_id: "repo-1",
				source_type: "repository",
				path: "src/components",
				max_depth: 2,
			},
			mockContext(),
		);

		expect(capturedUrl).toContain("path=src");
		expect(capturedUrl).toContain("max_depth=2");
	});

	it("returns API error on failure", async () => {
		const client = asSdkAdapter({
			get: async () => {
				throw new Error('HTTP 404: {"message":"not found"}');
			},
		});

		const tool = createNiaExploreTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository" },
			mockContext(),
		);

		expect(result).toContain("explore_error: HTTP 404");
		expect(result).toContain("not found");
	});

	it("resolves source via source_type + identifier", async () => {
		let treeUrl = "";
		const client = createResponseSdkAdapter(async (url) => {
				if (url.includes("/sources")) {
					return jsonResponse(200, {
						sources: [{ id: "r-id", type: "repository" }],
						total: 1,
					});
				}
				if (url.includes("/fs/r-id/tree")) {
					treeUrl = url;
					return jsonResponse(200, {
						repository: "owner/repo",
						branch: "main",
						tree: [{ path: "file.ts", type: "file", size: 5 }],
					});
				}
				return jsonResponse(404, { message: "not found" });
			});

		const tool = createNiaExploreTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_type: "repository", identifier: "owner/repo" },
			mockContext(),
		);

		expect(treeUrl).toContain("/fs/r-id/tree");
		expect(result).toContain("file.ts");
	});

	it("uses unified fs endpoint for data_source type", async () => {
		let capturedUrl = "";
		const client = createResponseSdkAdapter(async (url) => {
				capturedUrl = String(url);
				return jsonResponse(200, {
					repository: "docs-site",
					branch: "",
					tree: [{ path: "index.html", type: "file", size: 2048 }],
				});
			});

		const tool = createNiaExploreTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "ds-1", source_type: "data_source" },
			mockContext(),
		);

		expect(capturedUrl).toContain("/fs/ds-1/tree");
		expect(result).toContain("index.html");
	});

	it("handles empty tree gracefully", async () => {
		const client = createClient([
			{
				match: "/fs/repo-1/tree",
				response: { repository: "r", branch: "main", tree: [] },
			},
		]);

		const tool = createNiaExploreTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository" },
			mockContext(),
		);

		expect(result).toContain("No files found");
	});

	it("returns config_error when searchEnabled is false", async () => {
		const client = createClient([]);

		const disabledConfig = { ...TEST_CONFIG, searchEnabled: false };
		const tool = createNiaExploreTool(client, disabledConfig);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository" },
			mockContext(),
		);

		expect(result).toContain("config_error");
		expect(result).toContain("disabled");
	});

	it("returns config_error when apiKey is not set", async () => {
		const client = createClient([]);

		const noApiKeyConfig = { ...TEST_CONFIG, apiKey: "" };
		const tool = createNiaExploreTool(client, noApiKeyConfig);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository" },
			mockContext(),
		);

		expect(result).toContain("config_error");
		expect(result).toContain("API_KEY");
	});

	it("returns abort_error when request is aborted", async () => {
		const client = createClient([]);

		const abortController = new AbortController();
		const abortedContext: ToolContext = {
			...mockContext(),
			abort: abortController.signal,
		};

		// Abort immediately
		abortController.abort();

		const tool = createNiaExploreTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{ source_id: "repo-1", source_type: "repository" },
			abortedContext,
		);

		expect(result).toContain("abort_error");
		expect(result).toContain("nia_explore");
	});
});
