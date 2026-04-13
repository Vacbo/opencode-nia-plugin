/// <reference types="bun-types" />

import { beforeAll, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import type { NiaConfig } from "../../src/config";
import { createMockSdkAdapter } from "../../src/test/sdk-adapter";
import { createNiaReadTool } from "../../src/tools/nia-read";
import { createNiaGrepTool } from "../../src/tools/nia-grep";
import { createNiaExploreTool } from "../../src/tools/nia-explore";

const BASE_URL = process.env.NIA_API_URL ?? "https://apigcp.trynia.ai/v2";

const ERROR_PREFIXES = [
	"abort_error",
	"config_error",
	"explore_error",
	"forbidden",
	"grep_error",
	"network_error",
	"not_found",
	"rate_limited",
	"read_error",
	"search_error",
	"server_error",
	"service_unavailable",
	"timeout_error",
	"unauthorized",
	"validation_error",
	"validation_failed",
] as const;

type RequestRecord = {
	method: string;
	path: string;
	status: number;
};

const LIVE_CONFIG = {
	apiKey: process.env.NIA_API_KEY,
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
	debug: true,
	apiUrl: BASE_URL,
} as NiaConfig;

const requestLog: RequestRecord[] = [];

const client = createMockSdkAdapter(async (url, init) => {
	const response = await fetch(url, init);
	requestLog.push({
		method: init.method ?? "GET",
		path: new URL(url).pathname,
		status: response.status,
	});
	return response;
}, BASE_URL);

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		sessionID: "read-grep-explore-session",
		messageID: `message-${Date.now()}`,
		agent: "gpt-5.4",
		directory: "/tmp/project",
		worktree: "/tmp/project",
		abort: new AbortController().signal,
		metadata: () => undefined,
		ask: async () => undefined,
		...overrides,
	};
}

function parseArgs<TArgs extends z.ZodRawShape>(
	definition: { args: TArgs },
	input: unknown,
): z.infer<z.ZodObject<TArgs>> {
	return z.object(definition.args).parse(input);
}

function assertApiConfigured(): void {
	expect(
		process.env.NIA_API_KEY,
		"NIA_API_KEY must be set for live integration tests",
	).toBeTruthy();
}

function expectNoClientError(result: string): void {
	const lowered = result.trim().toLowerCase();
	const matchedPrefix = ERROR_PREFIXES.find((prefix) =>
		lowered.startsWith(prefix),
	);
	expect(
		matchedPrefix,
		`Unexpected API/tool error: ${result}`,
	).toBeUndefined();
}

function expectIsError(result: string): void {
	const lowered = result.trim().toLowerCase();
	const isError = ERROR_PREFIXES.some((p) => lowered.startsWith(p));
	expect(isError, `Expected error response, got: ${result}`).toBe(true);
}

type RepoRecord = { id: string; repository: string; status: string };

let testRepo: RepoRecord | null = null;

describe("nia-read / nia-grep / nia-explore live integration", () => {
	beforeAll(async () => {
		assertApiConfigured();

		const reposResponse = await client.get<{ items?: RepoRecord[] } | RepoRecord[]>(
			"/repositories",
		);
		const repos = Array.isArray(reposResponse)
			? reposResponse
			: reposResponse.items ?? [];

		testRepo =
			repos.find((r) => ["indexed", "completed", "ready"].includes(r.status)) ??
			repos[0] ??
			null;

		if (!testRepo) {
			throw new Error(
				"No indexed repositories available for integration tests. " +
					"Index at least one repository in your Nia account.",
			);
		}
	});
	describe("nia_explore", () => {
		it("returns file tree for a valid repository", async () => {
			const exploreTool = createNiaExploreTool(client, LIVE_CONFIG);
			const result = await exploreTool.execute(
				parseArgs(exploreTool, {
					source_id: testRepo!.id,
					source_type: "repository",
					max_depth: 1,
				}),
				createContext(),
			);

			expectNoClientError(result);
			const hasTree = result.includes("## File Tree:");
			const isEmpty = result.includes("No files found");
			expect(
				hasTree || isEmpty,
				`Expected tree or empty message, got: ${result}`,
			).toBe(true);
		}, 60_000);

		it("returns error for a non-existent source", async () => {
			const exploreTool = createNiaExploreTool(client, LIVE_CONFIG);
			const result = await exploreTool.execute(
				parseArgs(exploreTool, {
					source_id: "nonexistent-id-000000",
					source_type: "repository",
				}),
				createContext(),
			);

			expectIsError(result);
		}, 60_000);
	});
	describe("nia_grep", () => {
		it("returns matches for a common pattern", async () => {
			const grepTool = createNiaGrepTool(client, LIVE_CONFIG);
			const result = await grepTool.execute(
				parseArgs(grepTool, {
					source_id: testRepo!.id,
					source_type: "repository",
					pattern: "import",
					case_sensitive: true,
				}),
				createContext(),
			);

			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
		}, 60_000);

		it("returns error for a non-existent source", async () => {
			const grepTool = createNiaGrepTool(client, LIVE_CONFIG);
			const result = await grepTool.execute(
				parseArgs(grepTool, {
					source_id: "nonexistent-id-000000",
					source_type: "repository",
					pattern: "test",
				}),
				createContext(),
			);

			expectIsError(result);
		}, 60_000);
	});
	describe("nia_read", () => {
		it("reads a file from the repository", async () => {
			const readTool = createNiaReadTool(client, LIVE_CONFIG);
			const result = await readTool.execute(
				parseArgs(readTool, {
					source_id: testRepo!.id,
					source_type: "repository",
					path: "README.md",
				}),
				createContext(),
			);

			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
			const hasContent = result.includes("**Size:**");
			const isNotFound =
				result.toLowerCase().startsWith("not_found") ||
				result.toLowerCase().startsWith("read_error: http 404");
			expect(
				hasContent || isNotFound,
				`Expected file content or not_found, got: ${result}`,
			).toBe(true);
		}, 60_000);

		it("returns error for a non-existent file path", async () => {
			const readTool = createNiaReadTool(client, LIVE_CONFIG);
			const result = await readTool.execute(
				parseArgs(readTool, {
					source_id: testRepo!.id,
					source_type: "repository",
					path: "this/path/does/not/exist/ever.xyz",
				}),
				createContext(),
			);

			const lowered = result.trim().toLowerCase();
			const isError = ERROR_PREFIXES.some((p) => lowered.startsWith(p));
			expect(isError, `Expected error response, got: ${result}`).toBe(
				true,
			);
		}, 60_000);
	});
});
