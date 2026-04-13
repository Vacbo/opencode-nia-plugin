import { describe, expect, it, mock } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import type { SdkAdapter } from "../api/nia-sdk";
import type { NiaConfig } from "../config";
import { createNiaManageResourceTool } from "./nia-manage-resource";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, sandboxEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, annotationsEnabled: true, bulkDeleteEnabled: true, usageEnabled: true, feedbackEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] } } as NiaConfig;

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

	const unusedGet: SdkAdapter["get"] = async () => {
	throw new Error("not used");
};

	const unusedPatch: SdkAdapter["patch"] = async () => {
	throw new Error("not used");
};

	const unusedDelete: SdkAdapter["delete"] = async () => {
	throw new Error("not used");
};

	const unusedPost: SdkAdapter["post"] = async () => {
	throw new Error("not used");
};

describe("createNiaManageResourceTool", () => {
	it("lists repositories and data sources together", async () => {
		const calls: string[] = [];
		const client = {
			sources: {
				list: async (params?: unknown) => {
					calls.push(`/sources?type=${(params as Record<string, string>)?.type || ""}`);
					if ((params as Record<string, string>)?.type === "repository") {
						return [{ id: "repo_1" }];
					}
					return [{ id: "doc_1" }];
				},
			},
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
	} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
		client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, { action: "list" }),
			createContext(),
		);

		expect(calls).toEqual(["/sources?type=repository", "/sources?type=documentation"]);
		expect(JSON.parse(result)).toEqual({
			repositories: [{ id: "repo_1" }],
			data_sources: [{ id: "doc_1" }],
		});
	});

	it("returns resource status for the requested type", async () => {
		const client = {
			sources: {
				get: async (id: string) => ({ id, path: `/sources/${id}`, status: "ready" }),
			},
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
	} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
		client as unknown as SdkAdapter,
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
			id: "repo_1",
			path: "/sources/repo_1",
			status: "ready",
		});
	});

	it("renames a resource with the provided name", async () => {
		const calls: Array<{ path: string; body: unknown }> = [];
		const client = {
			sources: {
				update: async (id: string, body: unknown) => {
					calls.push({ path: `/sources/${id}`, body });
					return { ok: true };
				},
			},
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
	} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
		client as unknown as SdkAdapter,
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
				path: "/sources/doc_1",
				body: { name: "Updated docs", display_name: "Updated docs" },
			},
		]);
		expect(JSON.parse(result)).toEqual({ ok: true });
	});

	it("requests permission before deleting a resource", async () => {
		const ask = mock(async () => undefined);
		const deleteCalls: string[] = [];
		const client = {
			sources: {
				delete: async (id: string) => {
					deleteCalls.push(`/sources/${id}`);
					return { deleted: true };
				},
			},
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
	} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
		client as unknown as SdkAdapter,
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
		expect(deleteCalls).toEqual(["/sources/repo_1"]);
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
	} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
		client as unknown as SdkAdapter,
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
	} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
		client as unknown as SdkAdapter,
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
		expect(subscribeResult).toBe("deprecated: the unified Nia API no longer supports per-source subscription. Use category organization or the dependencies endpoints instead.");
		expect(JSON.parse(deleteResult)).toEqual({ deleted: true });
		expect(calls).toEqual([
			{ method: "GET", path: "/categories" },
			{
				method: "POST",
				path: "/categories",
				body: { name: "Docs", description: "Important docs" },
			},
			{ method: "DELETE", path: "/categories/cat_1" },
		]);
	});

	it("returns config_error when searchEnabled is false", async () => {
		const client = {
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
	} as unknown as SdkAdapter;
		const disabledConfig = { ...TEST_CONFIG, searchEnabled: false };
		const tool = createNiaManageResourceTool(
		client as unknown as SdkAdapter,
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
	} as unknown as SdkAdapter;
		const noApiKeyConfig = { ...TEST_CONFIG, apiKey: "" };
		const tool = createNiaManageResourceTool(
		client as unknown as SdkAdapter,
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
	} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
		client as unknown as SdkAdapter,
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
		} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, { action: "list" }),
			createContext(),
		);

		expect(result).toContain("error");
		expect(result).toContain("manage_resource");
	});

	it("creates an annotation on a resource", async () => {
		const calls: Array<{ method: string; path: string; body?: unknown }> = [];
		const client = {
			post: async <T>(path: string, body?: unknown) => {
				calls.push({ method: "POST", path, body });
				return { id: "ann_1", content: "Test annotation" } as T;
			},
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
		} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "annotation_create",
				resource_type: "repository",
				resource_id: "repo_1",
				content: "Test annotation",
			}),
			createContext(),
		);

		expect(calls).toEqual([
			{
				method: "POST",
				path: "/sources/repo_1/annotations",
				body: { content: "Test annotation" },
			},
		]);
		expect(JSON.parse(result)).toEqual({ id: "ann_1", content: "Test annotation" });
	});

	it("returns validation error when annotation_create lacks content", async () => {
		const client = {
			post: unusedPost,
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
		} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "annotation_create",
				resource_type: "repository",
				resource_id: "repo_1",
			}),
			createContext(),
		);

		expect(result).toBe('validation_failed [422]: action "annotation_create" requires content');
	});

	it("lists annotations for a resource", async () => {
		const calls: Array<{ method: string; path: string }> = [];
		const client = {
			get: async <T>(path: string) => {
				calls.push({ method: "GET", path });
				return [{ id: "ann_1", content: "First note" }, { id: "ann_2", content: "Second note" }] as T;
			},
			patch: unusedPatch,
			delete: unusedDelete,
			post: unusedPost,
		} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "annotation_list",
				resource_type: "repository",
				resource_id: "repo_1",
			}),
			createContext(),
		);

		expect(calls).toEqual([{ method: "GET", path: "/sources/repo_1/annotations" }]);
		expect(JSON.parse(result)).toEqual([
			{ id: "ann_1", content: "First note" },
			{ id: "ann_2", content: "Second note" },
		]);
	});

	it("deletes an annotation from a resource", async () => {
		const calls: Array<{ method: string; path: string }> = [];
		const client = {
			delete: async <T>(path: string) => {
				calls.push({ method: "DELETE", path });
				return { deleted: true } as T;
			},
			get: unusedGet,
			patch: unusedPatch,
			post: unusedPost,
		} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "annotation_delete",
				resource_type: "repository",
				resource_id: "repo_1",
				annotation_id: "ann_1",
			}),
			createContext(),
		);

		expect(calls).toEqual([{ method: "DELETE", path: "/sources/repo_1/annotations/ann_1" }]);
		expect(JSON.parse(result)).toEqual({ deleted: true });
	});

	it("returns validation error when annotation_delete lacks annotation_id", async () => {
		const client = {
			post: unusedPost,
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
		} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "annotation_delete",
				resource_type: "repository",
				resource_id: "repo_1",
			}),
			createContext(),
		);

		expect(result).toBe('validation_failed [422]: action "annotation_delete" requires annotation_id');
	});

	it("requests permission before bulk deleting resources", async () => {
		const ask = mock(async () => undefined);
		const postCalls: Array<{ path: string; body: unknown }> = [];
		const client = {
			post: async <T>(path: string, body?: unknown) => {
				postCalls.push({ path, body });
				return { deleted: ["repo_1", "repo_2"], failed: [] } as T;
			},
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
		} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "bulk_delete",
				resource_ids: ["repo_1", "repo_2"],
			}),
			createContext({ ask }),
		);

		expect(ask).toHaveBeenCalledTimes(1);
		expect(postCalls).toEqual([
			{
				path: "/sources/bulk-delete",
				body: { ids: ["repo_1", "repo_2"] },
			},
		]);
		expect(JSON.parse(result)).toEqual({ deleted: ["repo_1", "repo_2"], failed: [] });
	});

	it("does not bulk delete when permission is denied", async () => {
		const ask = mock(async () => {
			throw new Error("denied");
		});
		let postCalls = 0;
		const client = {
			post: async <T>() => {
				postCalls += 1;
				return { deleted: ["repo_1"], failed: [] } as T;
			},
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
		} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "bulk_delete",
				resource_ids: ["repo_1", "repo_2"],
			}),
			createContext({ ask }),
		);

		expect(ask).toHaveBeenCalledTimes(1);
		expect(postCalls).toBe(0);
		expect(result).toBe("Bulk delete cancelled.");
	});

	it("returns validation error when bulk_delete lacks resource_ids", async () => {
		const client = {
			post: unusedPost,
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
		} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "bulk_delete",
			}),
			createContext(),
		);

		expect(result).toBe('validation_failed [422]: action "bulk_delete" requires resource_ids array with at least one ID');
	});

	it("returns validation error when bulk_delete has empty resource_ids", async () => {
		const client = {
			post: unusedPost,
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
		} as unknown as SdkAdapter;
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			TEST_CONFIG,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "bulk_delete",
				resource_ids: [],
			}),
			createContext(),
		);

		expect(result).toBe('validation_failed [422]: action "bulk_delete" requires resource_ids array with at least one ID');
	});

	it("returns config_error when bulkDeleteEnabled is false", async () => {
		const client = {
			post: unusedPost,
			get: unusedGet,
			patch: unusedPatch,
			delete: unusedDelete,
		} as unknown as SdkAdapter;
		const disabledConfig = { ...TEST_CONFIG, bulkDeleteEnabled: false };
		const tool = createNiaManageResourceTool(
			client as unknown as SdkAdapter,
			disabledConfig,
		);

		const result = await tool.execute(
			parseArgs(tool, {
				action: "bulk_delete",
				resource_ids: ["repo_1"],
			}),
			createContext(),
		);

		expect(result).toBe("config_error: bulk delete is disabled");
	});
});
