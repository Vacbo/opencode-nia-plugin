import { describe, expect, it } from "bun:test";

import type { ToolContext } from "@opencode-ai/plugin";

import { type FetchFn, NiaClient } from "../api/client";
import type { E2ESession } from "../api/types";
import type { NiaConfig } from "../config";
import { createNiaE2ETool } from "./nia-e2e";

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

const SESSION_FIXTURE: E2ESession = {
	id: "e2e_ses_123",
	local_folder_id: "folder_123",
	expires_at: "2026-03-18T12:00:00Z",
	max_chunks: 50,
	allowed_operations: ["search", "read"],
};

describe("nia_e2e tool", () => {
	describe("feature flag", () => {
		it("registers when e2eEnabled is true", () => {
			const client = createClient(() => jsonResponse(200, SESSION_FIXTURE));

			expect(createNiaE2ETool(client, TEST_CONFIG)).toBeDefined();
		});

		it("returns null when e2eEnabled is false", () => {
			const client = createClient(() => jsonResponse(200, SESSION_FIXTURE));

			expect(
				createNiaE2ETool(client, { ...TEST_CONFIG, e2eEnabled: false }),
			).toBeNull();
		});
	});

	describe("create_session action", () => {
		it("posts to /daemon/e2e/sessions with default values", async () => {
			let capturedUrl = "";
			let capturedBody = "";

			const client = createClient((url, init) => {
				capturedUrl = url;
				capturedBody = init.body as string;
				return jsonResponse(201, SESSION_FIXTURE);
			});

			const tool = createNiaE2ETool(client, TEST_CONFIG)!;
			const result = await tool.execute(
				{ action: "create_session", local_folder_id: "folder_123" },
				createMockContext(),
			);

			expect(capturedUrl).toContain("/daemon/e2e/sessions");
			expect(JSON.parse(capturedBody)).toEqual({
				local_folder_id: "folder_123",
				ttl_seconds: 300,
				max_chunks: 50,
				allowed_operations: ["search", "read"],
			});
			expect(result).toContain("e2e_ses_123");
			expect(result).toContain("folder_123");
		});

		it("allows overriding ttl, max_chunks, and allowed_operations", async () => {
			let capturedBody = "";

			const client = createClient((_url, init) => {
				capturedBody = init.body as string;
				return jsonResponse(201, {
					...SESSION_FIXTURE,
					max_chunks: 10,
					allowed_operations: ["read"],
				});
			});

			const tool = createNiaE2ETool(client, TEST_CONFIG)!;
			await tool.execute(
				{
					action: "create_session",
					local_folder_id: "folder_123",
					ttl_seconds: 120,
					max_chunks: 10,
					allowed_operations: ["read"],
				},
				createMockContext(),
			);

			expect(JSON.parse(capturedBody)).toEqual({
				local_folder_id: "folder_123",
				ttl_seconds: 120,
				max_chunks: 10,
				allowed_operations: ["read"],
			});
		});

		it("returns an error when local_folder_id is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "create_session" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("local_folder_id");
		});

		it("propagates validation failures", async () => {
			const client = createClient(() =>
				jsonResponse(422, { message: "invalid local_folder_id" }),
			);
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "create_session", local_folder_id: "folder_123" },
				createMockContext(),
			);

			expect(result).toContain("validation_failed");
		});
	});

	describe("get_session action", () => {
		it("fetches /daemon/e2e/sessions/{session_id}", async () => {
			let capturedUrl = "";

			const client = createClient((url) => {
				capturedUrl = url;
				return jsonResponse(200, SESSION_FIXTURE);
			});

			const tool = createNiaE2ETool(client, TEST_CONFIG)!;
			const result = await tool.execute(
				{ action: "get_session", session_id: "e2e_ses_123" },
				createMockContext(),
			);

			expect(capturedUrl).toContain("/daemon/e2e/sessions/e2e_ses_123");
			expect(result).toContain("e2e_ses_123");
			expect(result).toContain("search, read");
		});

		it("returns an error when session_id is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "get_session" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("session_id");
		});

		it("propagates not found responses", async () => {
			const client = createClient(() =>
				jsonResponse(404, { message: "missing session" }),
			);
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "get_session", session_id: "missing" },
				createMockContext(),
			);

			expect(result).toContain("not_found");
		});
	});

	describe("purge action", () => {
		it("calls context.ask() before deleting source data", async () => {
			let askCalled = false;
			let deleteCalled = false;

			const client = createClient((url, init) => {
				deleteCalled = true;
				expect(url).toContain("/daemon/e2e/sources/source_123/data");
				expect(init.method).toBe("DELETE");
				return jsonResponse(200, { purged: true });
			});

			const tool = createNiaE2ETool(client, TEST_CONFIG)!;
			const result = await tool.execute(
				{ action: "purge", source_id: "source_123" },
				createMockContext({
					ask: async () => {
						askCalled = true;
					},
				}),
			);

			expect(askCalled).toBe(true);
			expect(deleteCalled).toBe(true);
			expect(result).toContain("source_123");
			expect(result).toContain("purged");
		});

		it("does not call delete when permission is rejected", async () => {
			let deleteCalled = false;

			const client = createClient(() => {
				deleteCalled = true;
				return jsonResponse(200, { purged: true });
			});

			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "purge", source_id: "source_123" },
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
				return jsonResponse(200, { purged: true });
			});

			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "purge", source_id: "source_123" },
				createMockContext({
					ask: async () => false as never,
				}),
			);

			expect(result).toBe("error: permission denied");
			expect(deleteCalled).toBe(false);
		});

		it("returns an error when source_id is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "purge" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("source_id");
		});

		it("propagates API errors on purge", async () => {
			const client = createClient(() =>
				jsonResponse(403, { message: "forbidden purge" }),
			);
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "purge", source_id: "source_123" },
				createMockContext(),
			);

			expect(result).toContain("forbidden");
		});
	});

	describe("sync action", () => {
		it("posts to /daemon/e2e/sync", async () => {
			let capturedUrl = "";
			let capturedBody = "";

			const client = createClient((url, init) => {
				capturedUrl = url;
				capturedBody = init.body as string;
				return jsonResponse(200, {
					local_folder_id: "folder_123",
					status: "queued",
					enqueued: 42,
				});
			});

			const tool = createNiaE2ETool(client, TEST_CONFIG)!;
			const result = await tool.execute(
				{ action: "sync", local_folder_id: "folder_123" },
				createMockContext(),
			);

			expect(capturedUrl).toContain("/daemon/e2e/sync");
			expect(JSON.parse(capturedBody)).toEqual({
				local_folder_id: "folder_123",
			});
			expect(result).toContain("queued");
			expect(result).toContain("folder_123");
		});

		it("returns an error when local_folder_id is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "sync" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("local_folder_id");
		});

		it("propagates rate limit errors", async () => {
			const client = createClient(() =>
				jsonResponse(429, { message: "slow down" }),
			);
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "sync", local_folder_id: "folder_123" },
				createMockContext(),
			);

			expect(result).toContain("rate_limited");
		});
	});

	describe("invalid action", () => {
		it("returns an error for unknown actions", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "unknown" as never },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("unknown");
		});
	});

	describe("error handling", () => {
		it("returns abort error when request is aborted", async () => {
			const abortController = new AbortController();
			abortController.abort();

			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "create_session", local_folder_id: "folder_123" },
				createMockContext({ abort: abortController.signal }),
			);

			expect(result).toBe("abort_error [nia_e2e]: request aborted");
		});

		it("returns config error when e2eEnabled is false", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaE2ETool(client, {
				...TEST_CONFIG,
				e2eEnabled: false,
			});

			expect(tool).toBeNull();
		});

		it("returns config error when apiKey is not set", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaE2ETool(client, { ...TEST_CONFIG, apiKey: "" })!;

			const result = await tool.execute(
				{ action: "create_session", local_folder_id: "folder_123" },
				createMockContext(),
			);

			expect(result).toBe("config_error: NIA_API_KEY is not set");
		});

		it("formats errors with e2e prefix", async () => {
			const client = createClient(() => {
				throw new Error("network error");
			});
			const tool = createNiaE2ETool(client, TEST_CONFIG)!;

			const result = await tool.execute(
				{ action: "create_session", local_folder_id: "folder_123" },
				createMockContext(),
			);

			expect(result).toContain("network_error");
			expect(result).toContain("network error");
		});
	});
});
