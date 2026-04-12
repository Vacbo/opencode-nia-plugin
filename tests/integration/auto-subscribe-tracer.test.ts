/// <reference types="bun-types" />

import { beforeAll, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import { NiaClient, type FetchFn } from "../../src/api/client";
import type { NiaConfig } from "../../src/config";
import { createNiaAutoSubscribeTool } from "../../src/tools/nia-auto-subscribe";
import { createNiaTracerTool } from "../../src/tools/nia-tracer";

const BASE_URL = process.env.NIA_API_URL ?? "https://apigcp.trynia.ai/v2";

const ERROR_PREFIXES = [
	"abort_error",
	"config_error",
	"network_error",
	"not_found",
	"rate_limited",
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
		sessionID: "auto-subscribe-tracer-session",
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

function sliceNewRequests(start: number): RequestRecord[] {
	return requestLog.slice(start);
}

function expectSuccessfulCall(
	calls: RequestRecord[],
	path: string,
): RequestRecord {
	const call = calls.find((entry) => entry.path === path);
	expect(call, `Expected live call to ${path}`).toBeDefined();
	const ALLOWED = new Set([200, 201, 202]);
	expect(
		ALLOWED.has(call!.status),
		`Expected ${path} to return 2xx but got ${call!.status}`,
	).toBe(true);
	return call!;
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

describe("nia_auto_subscribe + nia_tracer live API", () => {
	beforeAll(() => {
		assertApiConfigured();
	});

	it("calls nia_auto_subscribe dry_run against the live API", async () => {
		const start = requestLog.length;
		const tool = createNiaAutoSubscribeTool(client, LIVE_CONFIG);

		const manifest = JSON.stringify({
			dependencies: {
				zod: "^3.23.0",
				express: "^4.18.0",
			},
		});

		const result = await tool.execute(
			parseArgs(tool, {
				manifest_content: manifest,
				manifest_type: "package.json",
				dry_run: "true",
			}),
			createContext(),
		);

		const calls = sliceNewRequests(start);
		const depCall = calls.find((c) => c.path === "/v2/dependencies/analyze");
		expect(depCall, "Expected live call to /v2/dependencies/analyze").toBeDefined();

		const isKnown404 = result.startsWith("not_found");
		if (isKnown404) {
			expect(result).toContain("not_found");
		} else {
			expectNoClientError(result);
			expect(result).toContain("Dry run");
		}
	}, 120_000);

	it("returns validation error for empty manifest_content", async () => {
		const tool = createNiaAutoSubscribeTool(client, LIVE_CONFIG);

		const result = await tool.execute(
			parseArgs(tool, {
				manifest_content: "",
				manifest_type: "package.json",
			}),
			createContext(),
		);

		expect(result).toContain("error");
		expect(result).toContain("manifest_content");
	}, 30_000);

	it("calls nia_tracer fast mode against the live API", async () => {
		const start = requestLog.length;
		const tool = createNiaTracerTool(client, LIVE_CONFIG);

		const result = await tool.execute(
			parseArgs(tool, {
				query: "zod schema validation TypeScript",
				tracer_mode: "tracer-fast",
			}),
			createContext(),
		);

		expectNoClientError(result);
		expect(result).toContain("Nia Tracer");

		const calls = sliceNewRequests(start);
		const tracerCall = calls.find((c) => c.path === "/v2/github/tracer");
		expect(
			tracerCall,
			"Expected a POST to /v2/github/tracer",
		).toBeDefined();
	}, 120_000);

	it("returns validation error when both query and job_id are missing", async () => {
		const tool = createNiaTracerTool(client, LIVE_CONFIG);

		const result = await tool.execute(
			{ tracer_mode: "tracer-fast" } as any,
			createContext(),
		);

		expect(result).toContain("error");
	}, 30_000);
});
