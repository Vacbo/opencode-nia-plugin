import { describe, expect, it } from "bun:test";

import type { SdkAdapter } from "../api/nia-sdk";
import type { NiaConfig } from "../config";
import { createResponseSdkAdapter } from "../test/sdk-adapter";
import { createNiaFeedbackTool } from "./nia-feedback";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, sandboxEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, annotationsEnabled: true, bulkDeleteEnabled: true, usageEnabled: true, feedbackEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] } } as NiaConfig;

import type { ToolContext } from "@opencode-ai/plugin";

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

describe("nia_feedback tool", () => {
	describe("answer action", () => {
		it("posts to /feedback/answer with required fields", async () => {
			let capturedUrl = "";
			let capturedBody = "";

			const client = createClient((url, init) => {
				capturedUrl = url;
				capturedBody = init.body as string;
				return jsonResponse(200, { success: true });
			});

			const tool = createNiaFeedbackTool(client, TEST_CONFIG);
			const result = await tool.execute(
				{
					action: "answer",
					answer_id: "ans-123",
					feedback_type: "thumbs_up",
					comment: "Very helpful answer",
				},
				createMockContext(),
			);

			expect(capturedUrl).toContain("/feedback/answer");
			expect(JSON.parse(capturedBody)).toEqual({
				answer_id: "ans-123",
				feedback_type: "thumbs_up",
				comment: "Very helpful answer",
				metadata: undefined,
			});
			expect(result).toContain("Feedback submitted successfully");
			expect(result).toContain("ans-123");
		});

		it("posts with metadata when provided", async () => {
			let capturedBody = "";

			const client = createClient((url, init) => {
				capturedBody = init.body as string;
				return jsonResponse(200, { success: true });
			});

			const tool = createNiaFeedbackTool(client, TEST_CONFIG);
			await tool.execute(
				{
					action: "answer",
					answer_id: "ans-456",
					feedback_type: "thumbs_down",
					metadata: '{"reason": "incomplete", "score": 0.5}',
				},
				createMockContext(),
			);

			expect(JSON.parse(capturedBody)).toEqual({
				answer_id: "ans-456",
				feedback_type: "thumbs_down",
				comment: undefined,
				metadata: { reason: "incomplete", score: 0.5 },
			});
		});

		it("returns validation error when answer_id is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaFeedbackTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "answer", feedback_type: "thumbs_up" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("answer_id");
		});

		it("returns validation error when feedback_type is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaFeedbackTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "answer", answer_id: "ans-123" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("feedback_type");
		});
	});

	describe("source action", () => {
		it("posts to /feedback/source with required fields", async () => {
			let capturedUrl = "";
			let capturedBody = "";

			const client = createClient((url, init) => {
				capturedUrl = url;
				capturedBody = init.body as string;
				return jsonResponse(200, { success: true });
			});

			const tool = createNiaFeedbackTool(client, TEST_CONFIG);
			const result = await tool.execute(
				{
					action: "source",
					source_id: "src-789",
					feedback_type: "helpful",
					comment: "Great documentation",
				},
				createMockContext(),
			);

			expect(capturedUrl).toContain("/feedback/source");
			expect(JSON.parse(capturedBody)).toEqual({
				source_id: "src-789",
				feedback_type: "helpful",
				comment: "Great documentation",
				metadata: undefined,
			});
			expect(result).toContain("Feedback submitted successfully");
			expect(result).toContain("src-789");
		});

		it("returns validation error when source_id is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaFeedbackTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "source", feedback_type: "helpful" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("source_id");
		});

		it("returns validation error when feedback_type is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaFeedbackTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "source", source_id: "src-789" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("feedback_type");
		});
	});

	describe("interaction action", () => {
		it("posts to /feedback/interaction with required fields", async () => {
			let capturedUrl = "";
			let capturedBody = "";

			const client = createClient((url, init) => {
				capturedUrl = url;
				capturedBody = init.body as string;
				return jsonResponse(200, { success: true });
			});

			const tool = createNiaFeedbackTool(client, TEST_CONFIG);
			const result = await tool.execute(
				{
					action: "interaction",
					interaction_id: "int-abc",
					feedback_type: "viewed",
				},
				createMockContext(),
			);

			expect(capturedUrl).toContain("/feedback/interaction");
			expect(JSON.parse(capturedBody)).toEqual({
				interaction_id: "int-abc",
				feedback_type: "viewed",
				comment: undefined,
				metadata: undefined,
			});
			expect(result).toContain("Interaction signal submitted successfully");
			expect(result).toContain("int-abc");
		});

		it("returns validation error when interaction_id is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaFeedbackTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "interaction", feedback_type: "clicked" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("interaction_id");
		});

		it("returns validation error when feedback_type is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaFeedbackTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "interaction", interaction_id: "int-abc" },
				createMockContext(),
			);

			expect(result).toContain("error");
			expect(result).toContain("feedback_type");
		});
	});

	describe("invalid action", () => {
		it("returns error for unknown action", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const tool = createNiaFeedbackTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "unknown" as unknown as "answer" },
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
			const tool = createNiaFeedbackTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "answer", answer_id: "ans-123", feedback_type: "thumbs_up" },
				createMockContext(),
			);

			expect(result).toContain("feedback_error: HTTP 401: invalid api key");
		});
	});

	describe("config checks", () => {
		it("returns config_error when feedbackEnabled is false", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const config = { ...TEST_CONFIG, feedbackEnabled: false };
			const tool = createNiaFeedbackTool(client, config);

			const result = await tool.execute(
				{ action: "answer", answer_id: "ans-123", feedback_type: "thumbs_up" },
				createMockContext(),
			);

			expect(result).toContain("config_error");
			expect(result).toContain("disabled");
		});

		it("returns config_error when apiKey is missing", async () => {
			const client = createClient(() => jsonResponse(200, {}));
			const config = { ...TEST_CONFIG, apiKey: "" };
			const tool = createNiaFeedbackTool(client, config);

			const result = await tool.execute(
				{ action: "answer", answer_id: "ans-123", feedback_type: "thumbs_up" },
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
			const tool = createNiaFeedbackTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "answer", answer_id: "ans-123", feedback_type: "thumbs_up" },
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
			const tool = createNiaFeedbackTool(client, TEST_CONFIG);

			const result = await tool.execute(
				{ action: "answer", answer_id: "ans-123", feedback_type: "thumbs_up" },
				createMockContext(),
			);

			expect(result).toContain("feedback_error: unexpected network error");
		});
	});

	describe("metadata parsing", () => {
		it("ignores invalid metadata JSON", async () => {
			let capturedBody = "";

			const client = createClient((url, init) => {
				capturedBody = init.body as string;
				return jsonResponse(200, { success: true });
			});

			const tool = createNiaFeedbackTool(client, TEST_CONFIG);
			await tool.execute(
				{
					action: "answer",
					answer_id: "ans-123",
					feedback_type: "thumbs_up",
					metadata: "invalid json",
				},
				createMockContext(),
			);

			expect(JSON.parse(capturedBody).metadata).toBeUndefined();
		});
	});
});
