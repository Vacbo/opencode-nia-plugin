import { describe, expect, it } from "bun:test";

import { type FetchFn, NiaClient } from "../api/client";
import type { NiaConfig } from "../config";
import { createNiaAutoSubscribeTool } from "./nia-auto-subscribe";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] }, mcpServerName: "nia", mcpMaxRetries: 5, mcpReconnectBaseDelay: 100 } as NiaConfig;

import type { ToolContext } from "@opencode-ai/plugin";

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

function createMockContext(overrides?: Partial<ToolContext>): ToolContext {
	return {
		sessionID: "ses_1",
		messageID: "msg_1",
		agent: "test",
		directory: "/tmp",
		worktree: "/tmp",
		abort: new AbortController().signal,
		metadata: () => {},
		ask: async () => {},
		...overrides,
	};
}

const FIXTURE_DRY_RUN_RESPONSE = {
	dependencies: [
		{ name: "react", version: "18.2.0", ecosystem: "npm", status: "new" },
		{
			name: "typescript",
			version: "5.3.0",
			ecosystem: "npm",
			status: "already_tracked",
		},
	],
	total_new: 1,
	total_existing: 1,
};

const FIXTURE_SUBSCRIBE_RESPONSE = {
	dependencies: [
		{
			name: "react",
			version: "18.2.0",
			ecosystem: "npm",
			status: "subscribed",
		},
	],
	total_new: 1,
	total_existing: 1,
};

describe("nia_auto_subscribe tool", () => {
	describe("dry_run mode (default)", () => {
		it("posts to /dependencies with dry_run=true by default", async () => {
			let capturedUrl = "";
			let capturedBody = "";

			const client = createClient((url, init) => {
				capturedUrl = url;
				capturedBody = init.body as string;
				return jsonResponse(200, FIXTURE_DRY_RUN_RESPONSE);
			});

			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);
			const result = await tool.execute(
				{
					manifest_content: '{"dependencies":{"react":"^18.2.0"}}',
					manifest_type: "package.json",
				},
				createMockContext(),
			);

			expect(capturedUrl).toContain("/dependencies");
			const body = JSON.parse(capturedBody);
			expect(body.dry_run).toBe(true);
			expect(body.manifest_content).toBe(
				'{"dependencies":{"react":"^18.2.0"}}',
			);
			expect(body.manifest_type).toBe("package.json");
			expect(result).toContain("react");
			expect(result).toContain("18.2.0");
		});

		it("does NOT call context.ask() for dry_run=true", async () => {
			let askCalled = false;

			const client = createClient(() =>
				jsonResponse(200, FIXTURE_DRY_RUN_RESPONSE),
			);
			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);

			await tool.execute(
				{
					manifest_content: '{"dependencies":{}}',
					manifest_type: "package.json",
					dry_run: "true",
				},
				createMockContext({
					ask: async () => {
						askCalled = true;
					},
				}),
			);

			expect(askCalled).toBe(false);
		});
	});

	describe("live subscribe mode (dry_run=false)", () => {
		it("calls context.ask() before subscribing", async () => {
			let askCalled = false;

			const client = createClient(() =>
				jsonResponse(200, FIXTURE_SUBSCRIBE_RESPONSE),
			);
			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);

			const ctx = createMockContext({
				ask: async () => {
					askCalled = true;
				},
			});

			const result = await tool.execute(
				{
					manifest_content: '{"dependencies":{"react":"^18.2.0"}}',
					manifest_type: "package.json",
					dry_run: "false",
				},
				ctx,
			);

			expect(askCalled).toBe(true);
			expect(result).toContain("react");
		});

		it("does not subscribe when permission is rejected (throws)", async () => {
			let postCalled = false;

			const client = createClient(() => {
				postCalled = true;
				return jsonResponse(200, FIXTURE_SUBSCRIBE_RESPONSE);
			});

			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{
					manifest_content: '{"dependencies":{"react":"^18.2.0"}}',
					manifest_type: "package.json",
					dry_run: "false",
				},
				createMockContext({
					ask: async () => {
						throw new Error("permission denied");
					},
				}),
			);

			expect(result).toBe("error: permission denied");
			expect(postCalled).toBe(false);
		});

		it("does not subscribe when permission returns false", async () => {
			let postCalled = false;

			const client = createClient(() => {
				postCalled = true;
				return jsonResponse(200, FIXTURE_SUBSCRIBE_RESPONSE);
			});

			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{
					manifest_content: '{"dependencies":{"react":"^18.2.0"}}',
					manifest_type: "package.json",
					dry_run: "false",
				},
				createMockContext({
					ask: async () => false as never,
				}),
			);

			expect(result).toBe("error: permission denied");
			expect(postCalled).toBe(false);
		});

		it("sends dry_run=false in request body", async () => {
			let capturedBody = "";

			const client = createClient((_url, init) => {
				capturedBody = init.body as string;
				return jsonResponse(200, FIXTURE_SUBSCRIBE_RESPONSE);
			});

			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);

			await tool.execute(
				{
					manifest_content: "{}",
					manifest_type: "package.json",
					dry_run: "false",
				},
				createMockContext(),
			);

			expect(JSON.parse(capturedBody).dry_run).toBe(false);
		});
	});

	describe("validation", () => {
		it("requires manifest_content", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ manifest_content: "", manifest_type: "package.json" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("manifest_content");
		});

		it("requires manifest_type", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ manifest_content: "{}", manifest_type: "" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("manifest_type");
		});
	});

	describe("manifest types", () => {
		it("supports requirements.txt", async () => {
			let capturedBody = "";

			const client = createClient((_url, init) => {
				capturedBody = init.body as string;
				return jsonResponse(200, {
					dependencies: [],
					total_new: 0,
					total_existing: 0,
				});
			});

			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);
			await tool.execute(
				{
					manifest_content: "requests==2.31.0",
					manifest_type: "requirements.txt",
				},
				createMockContext(),
			);

			expect(JSON.parse(capturedBody).manifest_type).toBe("requirements.txt");
		});

		it("supports Cargo.toml", async () => {
			let capturedBody = "";

			const client = createClient((_url, init) => {
				capturedBody = init.body as string;
				return jsonResponse(200, {
					dependencies: [],
					total_new: 0,
					total_existing: 0,
				});
			});

			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);
			await tool.execute(
				{
					manifest_content: '[dependencies]\nserde = "1.0"',
					manifest_type: "Cargo.toml",
				},
				createMockContext(),
			);

			expect(JSON.parse(capturedBody).manifest_type).toBe("Cargo.toml");
		});

		it("supports go.mod", async () => {
			let capturedBody = "";

			const client = createClient((_url, init) => {
				capturedBody = init.body as string;
				return jsonResponse(200, {
					dependencies: [],
					total_new: 0,
					total_existing: 0,
				});
			});

			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);
			await tool.execute(
				{ manifest_content: "module example.com/foo", manifest_type: "go.mod" },
				createMockContext(),
			);

			expect(JSON.parse(capturedBody).manifest_type).toBe("go.mod");
		});
	});

	describe("error handling", () => {
		it("returns API error for 422", async () => {
			const client = createClient(() =>
				jsonResponse(422, { message: "invalid manifest" }),
			);
			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ manifest_content: "bad", manifest_type: "package.json" },
				createMockContext(),
			);

			expect(result).toContain("validation_failed");
		});

		it("returns API error for 401", async () => {
			const client = createClient(() =>
				jsonResponse(401, { message: "invalid key" }),
			);
			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ manifest_content: "{}", manifest_type: "package.json" },
				createMockContext(),
			);

			expect(result).toContain("unauthorized");
		});
	});

	describe("abort handling", () => {
		it("returns abort error when aborted", async () => {
			const abortController = new AbortController();
			abortController.abort();

			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaAutoSubscribeTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ manifest_content: "{}", manifest_type: "package.json" },
				createMockContext({ abort: abortController.signal }),
			);

			expect(result).toBe("abort_error [nia_auto_subscribe]: request aborted");
		});
	});

	describe("config checks", () => {
		it("returns config_error when searchEnabled is false", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const disabledConfig = { ...TEST_CONFIG, searchEnabled: false };
			const tool = createNiaAutoSubscribeTool(client, disabledConfig);

			const result = await tool.execute(
				{ manifest_content: "{}", manifest_type: "package.json" },
				createMockContext(),
			);

			expect(result).toBe("config_error: nia auto-subscribe is disabled");
		});

		it("returns config_error when apiKey is not set", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const noApiKeyConfig = { ...TEST_CONFIG, apiKey: "" };
			const tool = createNiaAutoSubscribeTool(client, noApiKeyConfig);

			const result = await tool.execute(
				{ manifest_content: "{}", manifest_type: "package.json" },
				createMockContext(),
			);

			expect(result).toBe("config_error: NIA_API_KEY is not set");
		});
	});

	describe("error formatting", () => {
		it("formats unexpected errors with auto_subscribe prefix when thrown", async () => {
			// Create a client that throws an error directly (not caught by client)
			const throwingClient = {
				post: async () => {
					throw new Error("Unexpected error");
				},
			} as unknown as NiaClient;

			const tool = createNiaAutoSubscribeTool(throwingClient, TEST_CONFIG);

			const result = await tool.execute(
				{ manifest_content: "{}", manifest_type: "package.json" },
				createMockContext(),
			);

			expect(result).toBe("auto_subscribe_error: Unexpected error");
		});
	});
});
