import { describe, expect, it, mock } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import type { NiaClient } from "../api/client";
import type { NiaConfig } from "../config";
import { createNiaManageResourceTool } from "./nia-manage-resource";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] } } as NiaConfig;

function parseArgs<TArgs extends z.ZodRawShape>(
	definition: { args: TArgs },
	input: unknown,
): z.infer<z.ZodObject<TArgs>> {
	return z.object(definition.args).parse(input);
}

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		sessionID: "session_1",
		messageID: "message_1",
		agent: "gpt-5.4",
		directory: "/tmp",
		worktree: "/tmp",
		abort: new AbortController().signal,
		metadata: () => undefined,
		ask: async () => undefined,
		...overrides,
	};
}

const unusedGet: NiaClient["get"] = async () => {
	throw new Error("not used");
};

const unusedPatch: NiaClient["patch"] = async () => {
	throw new Error("not used");
};

const unusedDelete: NiaClient["delete"] = async () => {
	throw new Error("not used");
};

const unusedPost: NiaClient["post"] = async () => {
	throw new Error("not used");
};

describe("createNiaManageResourceTool", () => {
	it("lists repositories and data sources together", async () => {
		const calls: string[] = [];
		const client = {
			get: async <T>(path: string) => {
				calls.push(path);

				if (path === "/repositories") {
					return [{ id: "repo_1" }] as T;
				}

				return [{ id: "doc_1" }] as T;
			},
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
		} as unknown as NiaClient;
		const tool = createNiaManageResourceTool(
			client as unknown as NiaClient,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, { action: "list" }),
			createContext(),
		);

		expect(calls).toEqual(["/repositories", "/data-sources"]);
		expect(JSON.parse(result)).toEqual({
			repositories: [{ id: "repo_1" }],
			data_sources: [{ id: "doc_1" }],
		});
	});

	it("returns resource status for the requested type", async () => {
		const client = {
			get: async <T>(path: string) => ({ path, status: "ready" }) as T,
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
		} as unknown as NiaClient;
		const tool = createNiaManageResourceTool(
			client as unknown as NiaClient,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "status",
				resource_type: "repository",
				resource_id: "repo_1",
			}),
			createContext(),
		);

		expect(JSON.parse(result)).toEqual({
			path: "/repositories/repo_1",
			status: "ready",
		});
	});

	it("renames a resource with the provided name", async () => {
		const calls: Array<{ path: string; body: unknown }> = [];
		const client = {
			get: unusedGet,
			patch: async <T>(path: string, body?: unknown) => {
				calls.push({ path, body });
				return { ok: true } as T;
			},
			delete: unusedDelete,
			post: unusedPost,
		} as unknown as NiaClient;
		const tool = createNiaManageResourceTool(
			client as unknown as NiaClient,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "rename",
				resource_type: "data_source",
				resource_id: "doc_1",
				name: "Updated docs",
			}),
			createContext(),
		);

		expect(calls).toEqual([
			{
				path: "/data-sources/doc_1",
				body: { name: "Updated docs", display_name: "Updated docs" },
			},
		]);
		expect(JSON.parse(result)).toEqual({ ok: true });
	});

	it("requests permission before deleting a resource", async () => {
		const ask = mock(async () => undefined);
		const deleteCalls: string[] = [];
		const client = {
			get: unusedGet,
			patch: unusedPatch,
			delete: async <T>(path: string) => {
				deleteCalls.push(path);
				return { deleted: true } as T;
			},
			post: unusedPost,
		} as unknown as NiaClient;
		const tool = createNiaManageResourceTool(
			client as unknown as NiaClient,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "delete",
				resource_type: "repository",
				resource_id: "repo_1",
			}),
			createContext({ ask }),
		);

		expect(ask).toHaveBeenCalledTimes(1);
		expect(deleteCalls).toEqual(["/repositories/repo_1"]);
		expect(JSON.parse(result)).toEqual({ deleted: true });
	});

	it("does not delete when permission is denied", async () => {
		const ask = mock(async () => {
			throw new Error("denied");
		});
		let deleteCalls = 0;
		const client = {
			get: unusedGet,
			patch: unusedPatch,
			delete: async <T>() => {
				deleteCalls += 1;
				return { deleted: true } as T;
			},
			post: unusedPost,
		} as unknown as NiaClient;
		const tool = createNiaManageResourceTool(
			client as unknown as NiaClient,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "delete",
				resource_type: "data_source",
				resource_id: "doc_1",
			}),
			createContext({ ask }),
		);

		expect(ask).toHaveBeenCalledTimes(1);
		expect(deleteCalls).toBe(0);
		expect(result).toBe("Delete cancelled.");
	});

	it("supports category creation, listing, subscription, and deletion", async () => {
		const calls: Array<{ method: string; path: string; body?: unknown }> = [];
		const client = {
			get: async <T>(path: string) => {
				calls.push({ method: "GET", path });
				return [{ id: "cat_1", name: "Docs" }] as T;
			},
			patch: unusedPatch,
			delete: async <T>(path: string) => {
				calls.push({ method: "DELETE", path });
				return { deleted: true } as T;
			},
			post: async <T>(path: string, body?: unknown) => {
				calls.push({ method: "POST", path, body });
				return { id: "cat_1" } as T;
			},
		} as unknown as NiaClient;
		const tool = createNiaManageResourceTool(
			client as unknown as NiaClient,
			TEST_CONFIG,
		);

		const context = createContext();
		const listResult = await tool.execute(
			parseArgs(tool, { action: "category_list" }),
			context,
		);
		const createResult = await tool.execute(
			parseArgs(tool, {
				action: "category_create",
				name: "Docs",
				description: "Important docs",
			}),
			context,
		);
		const subscribeResult = await tool.execute(
			parseArgs(tool, {
				action: "subscribe",
				resource_type: "category",
				resource_id: "cat_1",
			}),
			context,
		);
		const deleteResult = await tool.execute(
			parseArgs(tool, { action: "category_delete", resource_id: "cat_1" }),
			context,
		);

		expect(JSON.parse(listResult)).toEqual([{ id: "cat_1", name: "Docs" }]);
		expect(JSON.parse(createResult)).toEqual({ id: "cat_1" });
		expect(JSON.parse(subscribeResult)).toEqual({ id: "cat_1" });
		expect(JSON.parse(deleteResult)).toEqual({ deleted: true });
		expect(calls).toEqual([
			{ method: "GET", path: "/categories" },
			{
				method: "POST",
				path: "/categories",
				body: { name: "Docs", description: "Important docs" },
			},
			{ method: "POST", path: "/categories/cat_1/subscribe", body: undefined },
			{ method: "DELETE", path: "/categories/cat_1" },
		]);
	});

	it("returns config_error when searchEnabled is false", async () => {
		const client = {
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
		} as unknown as NiaClient;
		const disabledConfig = { ...TEST_CONFIG, searchEnabled: false };
		const tool = createNiaManageResourceTool(
			client as unknown as NiaClient,
			disabledConfig,
		);

		const result = await tool.execute(
			parseArgs(tool, { action: "list" }),
			createContext(),
		);

		expect(result).toBe("config_error: nia search is disabled");
	});

	it("returns config_error when apiKey is not set", async () => {
		const client = {
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
		} as unknown as NiaClient;
		const noApiKeyConfig = { ...TEST_CONFIG, apiKey: "" };
		const tool = createNiaManageResourceTool(
			client as unknown as NiaClient,
			noApiKeyConfig,
		);

		const result = await tool.execute(
			parseArgs(tool, { action: "list" }),
			createContext(),
		);

		expect(result).toBe("config_error: NIA_API_KEY is not set");
	});

	it("returns abort_error when request is aborted", async () => {
		const abortController = new AbortController();
		abortController.abort();
		const client = {
			get: async <T>() => ({ id: "repo_1" }) as T,
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
		} as unknown as NiaClient;
		const tool = createNiaManageResourceTool(
			client as unknown as NiaClient,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, { action: "list" }),
			createContext({ abort: abortController.signal }),
		);

		expect(result).toContain("abort_error");
	});

	it("handles errors gracefully and returns formatted error", async () => {
		const client = {
			get: async <_T>() => {
				throw new Error("Network error");
			},
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
		} as unknown as NiaClient;
		const tool = createNiaManageResourceTool(
			client as unknown as NiaClient,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, { action: "list" }),
			createContext(),
		);

		expect(result).toContain("error");
		expect(result).toContain("manage_resource");
	});
});
