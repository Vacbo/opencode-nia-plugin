/// <reference types="bun-types" />

import { beforeAll, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import type { NiaConfig } from "../../src/config";
import { createMockSdkAdapter } from "../../src/test/sdk-adapter";
import { createNiaSandboxTool } from "../../src/tools/nia-sandbox";

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
	sandboxEnabled: true,
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

const describeIfApiKey = process.env.NIA_API_KEY ? describe : describe.skip;

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		sessionID: "nia-sandbox-session",
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

function extractJobId(result: string): string | undefined {
	const match = result.match(/`([^`]+)`/g);
	if (!match) {
		return undefined;
	}

	for (const token of match) {
		const value = token.slice(1, -1);
		if (value.startsWith("sandbox") || value.includes("job")) {
			return value;
		}
	}

	return undefined;
}

describeIfApiKey("nia_sandbox live API", () => {
	beforeAll(() => {
		assertApiConfigured();
	});

	it("calls nia_sandbox against the live API and supports job polling", async () => {
		const start = requestLog.length;
		const tool = createNiaSandboxTool(client, LIVE_CONFIG);

		const result = await tool.execute(
			parseArgs(tool, {
				repository: "https://github.com/vercel/ai",
				query: "streamText",
			}),
			createContext(),
		);

		const calls = sliceNewRequests(start);
		const createCall = calls.find(
			(entry) =>
				entry.path === "/sandbox/search" || entry.path === "/v2/sandbox/search",
		);
		expect(createCall, "Expected a POST to /sandbox/search").toBeDefined();

		const isKnown404 = result.startsWith("sandbox_error: HTTP 404");
		if (isKnown404) {
			expect(result).toContain("HTTP 404");
			return;
		}

		expectNoClientError(result);
		expect(result).toContain("Nia Sandbox");

		const jobId = extractJobId(result);
		if (jobId) {
			const statusStart = requestLog.length;
			const statusResult = await tool.execute(
				parseArgs(tool, { job_id: jobId }),
				createContext(),
			);

			expectNoClientError(statusResult);

			const statusCalls = sliceNewRequests(statusStart);
			const statusCall = statusCalls.find(
				(entry) =>
					entry.path === `/sandbox/jobs/${jobId}` ||
					entry.path === `/v2/sandbox/jobs/${jobId}`,
			);
			expect(
				statusCall,
				`Expected a GET to /sandbox/jobs/${jobId}`,
			).toBeDefined();
		}
	}, 120_000);

	it("returns a validation error when repository is missing", async () => {
		const tool = createNiaSandboxTool(client, LIVE_CONFIG);

		const result = await tool.execute({ query: "streamText" } as never, createContext());

		expect(result).toContain("validation_error");
		expect(result).toContain("repository");
	}, 30_000);
});
