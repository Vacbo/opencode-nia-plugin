import { describe, expect, it } from "bun:test";

import type { SdkAdapter } from "../api/nia-sdk";
import type { NiaConfig } from "../config";
import { createResponseSdkAdapter } from "../test/sdk-adapter";
import { createNiaContextTool } from "./nia-context";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] } } as NiaConfig;

import type { ToolContext } from "@opencode-ai/plugin";
type ContextResponse = {
	id: string;
	title: string;
	summary: string;
	content: string;
	tags: string[];
	created_at: string;
	updated_at: string;
};

type ContextListResponse = {
	contexts: ContextResponse[];
	total: number;
};

function jsonResponse(status: number, body?: unknown): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function createClient(
	handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): SdkAdapter {
	return createResponseSdkAdapter(handler);
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

const FIXTURE_CONTEXT: ContextResponse = {
	id: "ctx-001",
	title: "Auth notes",
	summary: "OAuth2 implementation",
	content: "Detailed OAuth2 notes",
	tags: ["auth", "oauth"],
	created_at: "2025-03-01T08:00:00Z",
	updated_at: "2025-03-15T12:30:00Z",
};

const FIXTURE_LIST: ContextListResponse = {
	contexts: [FIXTURE_CONTEXT],
	total: 1,
};

describe("nia_context tool", () => {
	describe("save action", () => {
		it("posts to /contexts and returns formatted result", async () => {
			let capturedUrl = "";
			let capturedBody = "";

			const client = createClient((url, init) => {
				capturedUrl = url;
				capturedBody = init.body as string;
				return jsonResponse(201, FIXTURE_CONTEXT);
			});

			const tool = createNiaContextTool(client, TEST_CONFIG);
			const result = await tool.execute(
				{
					action: "save",
					title: "Auth notes",
					summary: "OAuth2 implementation",
					content: "Detailed OAuth2 notes",
					tags: "auth,oauth",
				},
				createMockContext(),
			);

			expect(capturedUrl).toContain("/contexts");
			expect(JSON.parse(capturedBody)).toEqual({
				title: "Auth notes",
				summary: "OAuth2 implementation",
				content: "Detailed OAuth2 notes",
				tags: ["auth", "oauth"],
				agent_source: "opencode-nia-plugin",
			});
			expect(result).toContain("ctx-001");
			expect(result).toContain("Auth notes");
		});

		it("returns validation error when title is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "save", title: "", summary: "s", content: "c" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("title");
		});

		it("returns validation error when content is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "save", title: "t", summary: "s", content: "" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("content");
		});
	});

	describe("list action", () => {
		it("fetches /contexts with optional params", async () => {
			let capturedUrl = "";

			const client = createClient((url) => {
				capturedUrl = url;
				return jsonResponse(200, FIXTURE_LIST);
			});

			const tool = createNiaContextTool(client, TEST_CONFIG);
			const result = await tool.execute(
				{ action: "list", limit: "5", offset: "0" },
				createMockContext(),
			);

			expect(capturedUrl).toContain("/contexts");
			expect(result).toContain("ctx-001");
			expect(result).toContain("Auth notes");
		});

		it("handles empty list", async () => {
			const client = createClient(() =>
				jsonResponse(200, { contexts: [], total: 0 }),
			);
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "list" },
				createMockContext(),
			);

			expect(result).toContain("0");
		});
	});

	describe("retrieve action", () => {
		it("fetches /contexts/{id}", async () => {
			let capturedUrl = "";

			const client = createClient((url) => {
				capturedUrl = url;
				return jsonResponse(200, FIXTURE_CONTEXT);
			});

			const tool = createNiaContextTool(client, TEST_CONFIG);
			const result = await tool.execute(
				{ action: "retrieve", id: "ctx-001" },
				createMockContext(),
			);

			expect(capturedUrl).toContain("/contexts/ctx-001");
			expect(result).toContain("Auth notes");
			expect(result).toContain("Detailed OAuth2 notes");
		});

		it("returns error when id is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "retrieve" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("id");
		});

		it("returns API error for 404", async () => {
			const client = createClient(() =>
				jsonResponse(404, { message: "not found" }),
			);
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "retrieve", id: "ctx-missing" },
				createMockContext(),
			);

			expect(result).toContain("context_error: HTTP 404: not found");
		});
	});

	describe("search action", () => {
		it("queries /contexts/semantic-search", async () => {
			let capturedUrl = "";

			const client = createClient((url) => {
				capturedUrl = url;
				return jsonResponse(200, FIXTURE_LIST);
			});

			const tool = createNiaContextTool(client, TEST_CONFIG);
			const result = await tool.execute(
				{
					action: "search",
					query: "auth flow",
					limit: "5",
					tags: "auth,security",
				},
				createMockContext(),
			);

			expect(capturedUrl).toContain("/contexts/semantic-search");
			expect(capturedUrl).toContain("q=auth+flow");
			expect(result).toContain("Auth notes");
		});

		it("returns error when query is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "search" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("query");
		});
	});

	describe("update action", () => {
		it("patches /contexts/{id}", async () => {
			let capturedUrl = "";
			let capturedBody = "";

			const updated = { ...FIXTURE_CONTEXT, title: "Updated title" };

			const client = createClient((url, init) => {
				capturedUrl = url;
				capturedBody = init.body as string;
				return jsonResponse(200, updated);
			});

			const tool = createNiaContextTool(client, TEST_CONFIG);
			const result = await tool.execute(
				{ action: "update", id: "ctx-001", title: "Updated title" },
				createMockContext(),
			);

			expect(capturedUrl).toContain("/contexts/ctx-001");
			expect(JSON.parse(capturedBody)).toMatchObject({
				title: "Updated title",
			});
			expect(result).toContain("Updated title");
		});

		it("returns error when id is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "update", title: "x" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("id");
		});
	});

	describe("delete action", () => {
		it("calls context.ask() before deleting", async () => {
			let askCalled = false;

			const client = createClient(() => jsonResponse(200, { deleted: true }));
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const ctx = createMockContext({
				ask: async () => {
					askCalled = true;
				},
			});

			const result = await tool.execute(
				{ action: "delete", id: "ctx-001" },
				ctx,
			);

			expect(askCalled).toBe(true);
			expect(result).toContain("deleted");
		});

		it("does not call delete when permission is rejected (throws)", async () => {
			let deleteCalled = false;

			const client = createClient(() => {
				deleteCalled = true;
				return jsonResponse(200, { deleted: true });
			});

			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "delete", id: "ctx-001" },
				createMockContext({
					ask: async () => {
						throw new Error("permission denied");
					},
				}),
			);

			expect(result).toBe("error: permission denied");
			expect(deleteCalled).toBe(false);
		});

		it("does not call delete when permission returns false", async () => {
			let deleteCalled = false;

			const client = createClient(() => {
				deleteCalled = true;
				return jsonResponse(200, { deleted: true });
			});

			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "delete", id: "ctx-001" },
				createMockContext({
					ask: async () => false as never,
				}),
			);

			expect(result).toBe("error: permission denied");
			expect(deleteCalled).toBe(false);
		});

		it("returns error when id is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "delete" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("id");
		});

		it("propagates API errors on delete", async () => {
			const client = createClient(() =>
				jsonResponse(404, { message: "not found" }),
			);
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "delete", id: "ctx-missing" },
				createMockContext(),
			);

			expect(result).toContain("context_error: HTTP 404: not found");
		});
	});

	describe("invalid action", () => {
		it("returns error for unknown action", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "unknown" as unknown as "save" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("unknown");
		});
	});

	describe("API error handling", () => {
		it("returns formatted error string from API", async () => {
			const client = createClient(() =>
				jsonResponse(401, { message: "invalid api key" }),
			);
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "list" },
				createMockContext(),
			);

			expect(result).toContain("context_error: HTTP 401: invalid api key");
		});
	});

	describe("config checks", () => {
		it("returns config_error when contextEnabled is false", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const config = { ...TEST_CONFIG, contextEnabled: false };
			const tool = createNiaContextTool(client, config);

			const result = await tool.execute(
				{ action: "list" },
				createMockContext(),
			);

			expect(result).toContain("config_error");
			expect(result).toContain("disabled");
		});

		it("returns config_error when apiKey is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const config = { ...TEST_CONFIG, apiKey: "" };
			const tool = createNiaContextTool(client, config);

			const result = await tool.execute(
				{ action: "list" },
				createMockContext(),
			);

			expect(result).toContain("config_error");
			expect(result).toContain("API_KEY");
		});
	});

	describe("abort signal handling", () => {
		it("returns abort_error when request is aborted", async () => {
			const abortController = new AbortController();
			abortController.abort();

			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "list" },
				createMockContext({ abort: abortController.signal }),
			);

			expect(result).toContain("abort_error");
		});
	});

	describe("error handling", () => {
		it("catches and formats unexpected errors", async () => {
			const client = createClient(() => {
				throw new Error("unexpected network error");
			});
			const tool = createNiaContextTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "list" },
				createMockContext(),
			);

			expect(result).toContain("context_error: unexpected network error");
		});
	});
});
