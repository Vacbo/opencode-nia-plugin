import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";
import { z } from "zod";

import type { SdkAdapter } from "../api/nia-sdk";
import type { NiaConfig } from "../config";
import { getSessionState } from "../state/session";
import { createNiaIndexTool } from "./nia-index";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, sandboxEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, annotationsEnabled: true, bulkDeleteEnabled: true, usageEnabled: true, feedbackEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, apiUrl: "https://apigcp.trynia.ai/v2" } as NiaConfig;

function parseArgs<TArgs extends z.ZodRawShape>(
	definition: { args: TArgs },
	input: unknown,
): z.infer<z.ZodObject<TArgs>> {
	return z.object(definition.args).parse(input);
}

describe("createNiaIndexTool", () => {
	it("auto-detects GitHub repositories and indexes them without polling", async () => {
		const calls: Array<{ path: string; body: unknown }> = [];
		const client = {
			post: async <T>(path: string, body?: unknown) => {
				calls.push({ path, body });
				return { source_id: "repo_123", status: "indexing" } as T;
			},
		};
		const tool = createNiaIndexTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, { url: "https://github.com/nozomio-labs/nia-opencode" }),
			{} as never,
		);

		expect(calls).toEqual([
			{
				path: "/sources",
				body: { type: "repository", url: "https://github.com/nozomio-labs/nia-opencode", repository: "nozomio-labs/nia-opencode" },
			},
		]);

		expect(JSON.parse(result)).toEqual({
			source_id: "repo_123",
			source_type: "repository",
			status: "queued",
			message: "Indexing started. Use nia_manage_resource to check progress.",
		});
	});

	it("indexes documentation sources with an optional display name", async () => {
		const calls: Array<{ path: string; body: unknown }> = [];
		const client = {
			post: async <T>(path: string, body?: unknown) => {
				calls.push({ path, body });
				return { id: "doc_123" } as T;
			},
		};
		const tool = createNiaIndexTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				url: "https://docs.trynia.ai/sdk/examples",
				name: "Nia SDK docs",
			}),
			{} as never,
		);

		expect(calls).toEqual([
			{
				path: "/sources",
				body: {
					type: "documentation",
					url: "https://docs.trynia.ai/sdk/examples",
					display_name: "Nia SDK docs",
				},
			},
		]);

		expect(JSON.parse(result)).toMatchObject({
			source_id: "doc_123",
			source_type: "data_source",
		});
	});

	it("routes arXiv URLs to research paper indexing", async () => {
		const calls: Array<{ path: string; body: unknown }> = [];
		const client = {
			post: async <T>(path: string, body?: unknown) => {
				calls.push({ path, body });
				return { source_id: "paper_123" } as T;
			},
		};
		const tool = createNiaIndexTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, { url: "https://arxiv.org/abs/2401.01234" }),
			{} as never,
		);

		expect(calls).toEqual([
			{
				path: "/sources",
				body: { type: "research_paper", url: "https://arxiv.org/abs/2401.01234" },
			},
		]);

		expect(JSON.parse(result)).toMatchObject({
			source_id: "paper_123",
			source_type: "research_paper",
		});
	});

	it("tracks index operations via pendingOps when sessionID is available", async () => {
		const client = {
			post: async <T>() => ({ source_id: "repo_tracked_1" }) as T,
		};
		const indexTool = createNiaIndexTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);
		const controller = new AbortController();
		const context = {
			sessionID: "index-track-session",
			messageID: "msg-1",
			agent: "test",
			directory: "/tmp",
			worktree: "/tmp",
			abort: controller.signal,
			metadata() {},
			ask: async () => {},
		} as unknown as ToolContext;

		const result = await indexTool.execute(
			parseArgs(indexTool, { url: "https://github.com/acme/widgets" }),
			context,
		);

		expect(JSON.parse(result)).toMatchObject({
			source_id: "repo_tracked_1",
			source_type: "repository",
		});

		const sessionState = getSessionState("index-track-session");
		const tracked = sessionState.pendingOps.getOperation("repo_tracked_1");
		expect(tracked).toBeDefined();
		expect(tracked?.type).toBe("index");
		expect(tracked?.sourceType).toBe("repository");
		expect(tracked?.name).toBe("https://github.com/acme/widgets");
		expect(tracked?.status).toBe("pending");
	});

	it("skips tracking when sessionID is missing", async () => {
		const client = {
			post: async <T>() => ({ source_id: "repo_no_track" }) as T,
		};
		const indexTool = createNiaIndexTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await indexTool.execute(
			parseArgs(indexTool, { url: "https://github.com/acme/other" }),
			{} as never,
		);

		expect(JSON.parse(result)).toMatchObject({ source_id: "repo_no_track" });
	});

	it("returns formatted error for API errors", async () => {
		const client = {
			post: async <_T>() => {
				throw new Error("HTTP 422: unsupported url");
			},
		};
		const tool = createNiaIndexTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, { url: "https://github.com/nozomio-labs/nia-opencode" }),
			{} as never,
		);

		expect(result).toContain("index_error: HTTP 422: unsupported url");
	});

	it("returns config_error when searchEnabled is false", async () => {
		const client = {
			post: async <T>() => ({ source_id: "repo_123" }) as T,
		};
		const config = { ...TEST_CONFIG, searchEnabled: false };
		const tool = createNiaIndexTool(client as unknown as SdkAdapter, config);

		const result = await tool.execute(
			parseArgs(tool, { url: "https://github.com/nozomio-labs/nia-opencode" }),
			{} as never,
		);

		expect(result).toBe("config_error: nia search is disabled");
	});

	it("returns config_error when apiKey is missing", async () => {
		const client = {
			post: async <T>() => ({ source_id: "repo_123" }) as T,
		};
		const config = { ...TEST_CONFIG, apiKey: "" };
		const tool = createNiaIndexTool(client as unknown as SdkAdapter, config);

		const result = await tool.execute(
			parseArgs(tool, { url: "https://github.com/nozomio-labs/nia-opencode" }),
			{} as never,
		);

		expect(result).toBe("config_error: NIA_API_KEY is not set");
	});

	it("returns abort_error when request is aborted", async () => {
		const client = {
			post: async <_T>() => {
				throw new Error("should not reach client");
			},
		};
		const tool = createNiaIndexTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);
		const controller = new AbortController();
		controller.abort();
		const context = { abort: controller.signal } as never;

		const result = await tool.execute(
			parseArgs(tool, { url: "https://github.com/nozomio-labs/nia-opencode" }),
			context,
		);

		expect(result).toBe("abort_error [nia_index]: request aborted");
	});

	it("returns formatted error when unexpected error occurs", async () => {
		const client = {
			post: async <_T>() => {
				throw new Error("Network error");
			},
		};
		const tool = createNiaIndexTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, { url: "https://github.com/nozomio-labs/nia-opencode" }),
			{} as never,
		);

		expect(result).toContain("error");
		expect(result).toContain("index");
	});
});
