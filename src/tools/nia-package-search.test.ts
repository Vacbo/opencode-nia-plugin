import { describe, expect, it } from "bun:test";

import { type FetchFn, NiaClient } from "../api/client";
import type { NiaConfig } from "../config";
import { createNiaPackageSearchTool } from "./nia-package-search";

const TEST_CONFIG = {
	apiKey: "nk_test",
	searchEnabled: true,
	researchEnabled: true,
	tracerEnabled: true,
	advisorEnabled: true,
	contextEnabled: true,
	e2eEnabled: true,
	cacheTTL: 300,
	maxPendingOps: 5,
	checkInterval: 15,
	tracerTimeout: 120,
	debug: false,
	triggersEnabled: true,
	apiUrl: "https://apigcp.trynia.ai/v2",
	keywords: { enabled: true, customPatterns: [] },
} as NiaConfig;

import type { ToolContext } from "@opencode-ai/plugin";
import type { PackageSearchResponse } from "../api/types";

function jsonResponse(status: number, body?: unknown): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function createFetchMock(
	handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): FetchFn {
	return async (input: RequestInfo | URL, init?: RequestInit) =>
		handler(String(input), init ?? {});
}

function createClient(
	handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): NiaClient {
	return new NiaClient({
		apiKey: "nk_test",
		fetchFn: createFetchMock(handler),
	});
}

function createMockContext(): ToolContext {
	return {
		sessionID: "ses_1",
		messageID: "msg_1",
		agent: "test",
		directory: "/tmp",
		worktree: "/tmp",
		abort: new AbortController().signal,
		metadata: () => {},
		ask: async () => {},
	};
}

const FIXTURE_RESPONSE: PackageSearchResponse = {
	results: [
		{
			package_name: "openai",
			version: "1.12.0",
			description: "Official OpenAI API client",
			repository_url: "https://github.com/openai/openai-node",
			code_results: [
				{
					file_path: "src/index.ts",
					content: "export class OpenAI { constructor(apiKey: string) {} }",
					score: 0.95,
				},
				{
					file_path: "src/streaming.ts",
					content: "export async function* stream() {}",
					score: 0.91,
				},
			],
		},
	],
	total: 1,
};

describe("nia_package_search tool", () => {
	it("posts to /package-search/hybrid with correct body", async () => {
		let capturedUrl = "";
		let capturedBody = "";

		const client = createClient((url, init) => {
			capturedUrl = url;
			capturedBody = init.body as string;
			return jsonResponse(200, FIXTURE_RESPONSE);
		});

		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);
		const result = await tool.execute(
			{
				registry: "npm",
				package_name: "openai",
				semantic_queries: "chat completion streaming",
				pattern: "createChatCompletion",
			},
			createMockContext(),
		);

		expect(capturedUrl).toContain("/package-search/hybrid");
		const body = JSON.parse(capturedBody);
		expect(body.registry).toBe("npm");
		expect(body.package_name).toBe("openai");
		expect(body.semantic_queries).toEqual(["chat completion streaming"]);
		expect(result).toContain("openai");
		expect(result).toContain("1.12.0");
		expect(result).toContain("src/index.ts");
	});

	it("requires registry", async () => {
		const client = createClient(() => jsonResponse(200, {}));
		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);

		const result = await tool.execute(
			{ registry: "" as any, package_name: "openai" },
			createMockContext(),
		);

		expect(result).toContain("error");
		expect(result).toContain("registry");
	});

	it("requires package_name", async () => {
		const client = createClient(() => jsonResponse(200, {}));
		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);

		const result = await tool.execute(
			{ registry: "npm", package_name: "" },
			createMockContext(),
		);

		expect(result).toContain("error");
		expect(result).toContain("package_name");
	});

	it("supports pypi registry", async () => {
		let capturedBody = "";

		const client = createClient((_url, init) => {
			capturedBody = init.body as string;
			return jsonResponse(200, { results: [], total: 0 });
		});

		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);
		await tool.execute(
			{ registry: "pypi", package_name: "requests" },
			createMockContext(),
		);

		expect(JSON.parse(capturedBody).registry).toBe("pypi");
	});

	it("supports crates registry", async () => {
		let capturedBody = "";

		const client = createClient((_url, init) => {
			capturedBody = init.body as string;
			return jsonResponse(200, { results: [], total: 0 });
		});

		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);
		await tool.execute(
			{ registry: "crates", package_name: "serde" },
			createMockContext(),
		);

		expect(JSON.parse(capturedBody).registry).toBe("crates");
	});

	it("supports go registry", async () => {
		let capturedBody = "";

		const client = createClient((_url, init) => {
			capturedBody = init.body as string;
			return jsonResponse(200, { results: [], total: 0 });
		});

		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);
		await tool.execute(
			{ registry: "go", package_name: "gin" },
			createMockContext(),
		);

		expect(JSON.parse(capturedBody).registry).toBe("go");
	});

	it("handles empty results", async () => {
		const client = createClient(() =>
			jsonResponse(200, { results: [], total: 0 }),
		);
		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);

		const result = await tool.execute(
			{ registry: "npm", package_name: "nonexistent-pkg" },
			createMockContext(),
		);

		expect(result).toContain("No results");
	});

	it("handles multiple semantic queries", async () => {
		let capturedBody = "";

		const client = createClient((_url, init) => {
			capturedBody = init.body as string;
			return jsonResponse(200, { results: [], total: 0 });
		});

		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);
		await tool.execute(
			{
				registry: "npm",
				package_name: "openai",
				semantic_queries: "streaming,chat completion,embeddings",
			},
			createMockContext(),
		);

		const body = JSON.parse(capturedBody);
		expect(body.semantic_queries).toEqual([
			"streaming",
			"chat completion",
			"embeddings",
		]);
	});

	it("returns API error strings", async () => {
		const client = createClient(() =>
			jsonResponse(422, { message: "invalid registry" }),
		);
		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);

		const result = await tool.execute(
			{ registry: "npm", package_name: "test" },
			createMockContext(),
		);

		expect(result).toContain("validation_failed");
	});

	it("returns 401 error", async () => {
		const client = createClient(() =>
			jsonResponse(401, { message: "bad key" }),
		);
		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);

		const result = await tool.execute(
			{ registry: "npm", package_name: "test" },
			createMockContext(),
		);

		expect(result).toContain("unauthorized");
	});

	it("returns config_error when apiKey is missing", async () => {
		const client = createClient(() =>
			jsonResponse(200, { results: [], total: 0 }),
		);
		const configWithoutApiKey = { ...TEST_CONFIG, apiKey: "" };
		const tool = createNiaPackageSearchTool(client, configWithoutApiKey);

		const result = await tool.execute(
			{ registry: "npm", package_name: "test" },
			createMockContext(),
		);

		expect(result).toContain("config_error");
		expect(result).toContain("NIA_API_KEY");
	});

	it("returns config_error when searchEnabled is false", async () => {
		const client = createClient(() =>
			jsonResponse(200, { results: [], total: 0 }),
		);
		const configDisabled = { ...TEST_CONFIG, searchEnabled: false };
		const tool = createNiaPackageSearchTool(client, configDisabled);

		const result = await tool.execute(
			{ registry: "npm", package_name: "test" },
			createMockContext(),
		);

		expect(result).toContain("config_error");
		expect(result).toContain("disabled");
	});

	it("returns abort_error when request is aborted", async () => {
		const abortController = new AbortController();
		const client = createClient(() =>
			jsonResponse(200, { results: [], total: 0 }),
		);
		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);

		const mockContext: ToolContext = {
			sessionID: "ses_1",
			messageID: "msg_1",
			agent: "test",
			directory: "/tmp",
			worktree: "/tmp",
			abort: abortController.signal,
			metadata: () => {},
			ask: async () => {},
		};

		// Abort immediately
		abortController.abort();

		const result = await tool.execute(
			{ registry: "npm", package_name: "test" },
			mockContext,
		);

		expect(result).toContain("abort_error");
		expect(result).toContain("package_search");
	});

	it("formats unexpected errors via client error handling", async () => {
		const client = createClient(() => {
			throw new Error("Network error");
		});
		const tool = createNiaPackageSearchTool(client, TEST_CONFIG);

		const result = await tool.execute(
			{ registry: "npm", package_name: "test" },
			createMockContext(),
		);

		expect(result).toContain("network_error");
	});
});
