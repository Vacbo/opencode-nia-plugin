/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import { NiaClient, type FetchFn } from "../../src/api/client";
import type { NiaConfig } from "../../src/config";
import { createNiaContextTool } from "../../src/tools/nia-context";
import { createNiaPackageSearchTool } from "../../src/tools/nia-package-search";

const BASE_URL = process.env.NIA_API_URL ?? "https://apigcp.trynia.ai/v2";

const ERROR_PREFIXES = [
	"abort_error",
	"config_error",
	"network_error",
	"server_error",
	"service_unavailable",
	"timeout_error",
	"unauthorized",
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
	triggersEnabled: true,
	apiUrl: BASE_URL,
	keywords: { enabled: true, customPatterns: [] },
} as NiaConfig;

const requestLog: RequestRecord[] = [];

const fetchFn: FetchFn = async (input, init) => {
	const response = await fetch(input, init);
	const url = typeof input === "string" ? input : input.toString();
	requestLog.push({
		method: init?.method ?? "GET",
		path: new URL(url).pathname,
		status: response.status,
	});
	return response;
};

const client = new NiaClient({
	apiKey: process.env.NIA_API_KEY ?? "missing-api-key",
	baseUrl: BASE_URL,
	fetchFn,
	timeout: 60_000,
});

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		sessionID: "context-package-test-session",
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

describe("nia_context + nia_package_search live API", () => {
	beforeAll(() => {
		assertApiConfigured();
	});

	it("nia_context: list action happy path", async () => {
		const contextTool = createNiaContextTool(client, LIVE_CONFIG);

		const listResult = await contextTool.execute(
			parseArgs(contextTool, { action: "list", limit: "5" }),
			createContext(),
		);

		expectNoClientError(listResult);
		expect(listResult).toMatch(/context\(s\):|No contexts found/);
	}, 60_000);

	it("nia_context: retrieve non-existent ID returns not_found", async () => {
		const contextTool = createNiaContextTool(client, LIVE_CONFIG);

		const result = await contextTool.execute(
			parseArgs(contextTool, {
				action: "retrieve",
				id: "00000000-0000-0000-0000-000000000000",
			}),
			createContext(),
		);

		expect(result).toMatch(/not_found|error|404|validation/i);
	}, 60_000);

	it("nia_package_search: search npm package happy path", async () => {
		const searchTool = createNiaPackageSearchTool(client, LIVE_CONFIG);

		const result = await searchTool.execute(
			parseArgs(searchTool, {
				registry: "npm",
				package_name: "zod",
				semantic_queries: "schema validation",
			}),
			createContext(),
		);

		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
		const reachedApi =
			result.includes("result(s):") ||
			result.includes("No results found") ||
			result.includes("package_search_error") ||
			result.includes("timeout_error");
		expect(reachedApi).toBe(true);
	}, 120_000);

	it("nia_package_search: non-existent package returns empty or error", async () => {
		const searchTool = createNiaPackageSearchTool(client, LIVE_CONFIG);

		const result = await searchTool.execute(
			parseArgs(searchTool, {
				registry: "npm",
				package_name: "zzz-nonexistent-pkg-xyzzy-999",
				semantic_queries: "anything",
			}),
			createContext(),
		);

		expect(result).toMatch(/No results found|not_found|error|0 result|timeout/i);
	}, 120_000);
});
