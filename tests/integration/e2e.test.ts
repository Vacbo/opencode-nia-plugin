/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import { NiaClient, type FetchFn } from "../../src/api/client";
import type { NiaConfig } from "../../src/config";
import { createNiaE2ETool } from "../../src/tools/nia-e2e";

const BASE_URL = process.env.NIA_API_URL ?? "https://apigcp.trynia.ai/v2";

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

const shortTimeoutClient = new NiaClient({
	apiKey: process.env.NIA_API_KEY ?? "missing-api-key",
	baseUrl: BASE_URL,
	fetchFn,
	timeout: 15_000,
});

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		sessionID: "e2e-integration-session",
		messageID: `message-${Date.now()}`,
		agent: "test",
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

describe("nia_e2e live API integration", () => {
	it("calls create_session against the live API and receives a session or a known API error", async () => {
		assertApiConfigured();

		const start = requestLog.length;
		const e2eTool = createNiaE2ETool(client, LIVE_CONFIG);
		expect(e2eTool, "e2e tool should be created when e2eEnabled is true").toBeDefined();

		const result = await e2eTool!.execute(
			parseArgs(e2eTool!, {
				action: "create_session",
				local_folder_id: `integration-test-${Date.now()}`,
				ttl_seconds: 60,
				max_chunks: 10,
				allowed_operations: ["search", "read"],
			}),
			createContext(),
		);

		const calls = sliceNewRequests(start);
		expect(calls.length).toBeGreaterThan(0);

		const sessionCall = calls.find((c) =>
			c.path.includes("/daemon/e2e/sessions"),
		);
		expect(
			sessionCall,
			"Expected a live call to /daemon/e2e/sessions",
		).toBeDefined();

		const isSession = result.includes("Session ID:");
		const isKnownError =
			result.includes("not_found") ||
			result.includes("validation_failed") ||
			result.includes("unauthorized") ||
			result.includes("forbidden") ||
			result.includes("server_error") ||
			result.includes("service_unavailable");

		expect(
			isSession || isKnownError,
			`Expected session or known API error, got: ${result}`,
		).toBe(true);
	}, 60_000);

	it("returns a not_found or known error for get_session with a non-existent session ID", async () => {
		assertApiConfigured();

		const start = requestLog.length;
		const e2eTool = createNiaE2ETool(shortTimeoutClient, LIVE_CONFIG);
		expect(e2eTool).toBeDefined();

		const result = await e2eTool!.execute(
			parseArgs(e2eTool!, {
				action: "get_session",
				session_id: "nonexistent-session-00000000",
			}),
			createContext(),
		);

		const calls = sliceNewRequests(start);
		expect(calls.length).toBeGreaterThan(0);

		const getCall = calls.find((c) =>
			c.path.includes("/daemon/e2e/sessions/nonexistent-session-00000000"),
		);
		expect(
			getCall,
			"Expected a live call to /daemon/e2e/sessions/nonexistent-session-00000000",
		).toBeDefined();

		expect(result).not.toContain("E2E session details.");

		const isExpectedError =
			result.includes("not_found") ||
			result.includes("validation_failed") ||
			result.includes("unauthorized") ||
			result.includes("forbidden") ||
			result.includes("server_error") ||
			result.includes("service_unavailable") ||
			result.includes("timeout_error");

		expect(
			isExpectedError,
			`Expected a structured API error for missing session, got: ${result}`,
		).toBe(true);
	}, 90_000);
});
