/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import type { NiaConfig } from "../../src/config";
import { createMockSdkAdapter } from "../../src/test/sdk-adapter";
import { createNiaDocumentAgentTool } from "../../src/tools/nia-document-agent";
import { createNiaIndexTool } from "../../src/tools/nia-index";

const BASE_URL = process.env.NIA_API_URL ?? "https://apigcp.trynia.ai/v2";
const TEST_PDF_URL = `https://arxiv.org/pdf/1706.03762.pdf?nia-live-test=${Date.now()}`;
const ERROR_PREFIXES = [
	"abort_error",
	"config_error",
	"document_agent_error",
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

const READY_SOURCE_STATUSES = new Set([
	"active",
	"completed",
	"indexed",
	"ready",
	"success",
	"succeeded",
	"synced",
]);
const FAILED_SOURCE_STATUSES = new Set(["cancelled", "error", "failed"]);

type RequestRecord = {
	method: string;
	path: string;
	status: number;
};

type IndexedSource = {
	id?: string;
	status?: string;
	type?: string;
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
	annotationsEnabled: true,
	bulkDeleteEnabled: true,
	usageEnabled: true,
	feedbackEnabled: true,
	documentAgentEnabled: true,
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
const cleanupSourceIds = new Set<string>();

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
		sessionID: "nia-document-agent-session",
		messageID: `message-${Date.now()}`,
		agent: "gpt-5.4",
		directory: "/tmp/project",
		worktree: "/tmp/project",
		abort: new AbortController().signal,
		metadata: () => undefined,
		ask: async () => undefined,
		...overrides,
	} as ToolContext;
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
		if (value.startsWith("doc_") || value.includes("job")) {
			return value;
		}
	}

	return undefined;
}

function isRetryableDocumentAgentError(result: string): boolean {
	const lowered = result.trim().toLowerCase();
	if (!lowered.startsWith("document_agent_error")) {
		return false;
	}

	return /(index|queued|processing|not ready|not found|404)/i.test(result);
}

function isMissingJobError(result: string): boolean {
	return /document_agent_error: http 404/i.test(result);
}

async function wait(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeWithRetries(
	execute: () => Promise<string>,
	maxAttempts: number,
	delayMs: number,
): Promise<string> {
	let lastResult = "";

	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		lastResult = await execute();
		if (!isRetryableDocumentAgentError(lastResult)) {
			return lastResult;
		}

		if (attempt < maxAttempts - 1) {
			await wait(delayMs);
		}
	}

	return lastResult;
}

async function pollSourceReady(sourceId: string): Promise<IndexedSource> {
	for (let attempt = 0; attempt < 45; attempt += 1) {
		const source = (await client.sources.get(sourceId)) as IndexedSource;
		const status = source.status?.toLowerCase();

		if (status && READY_SOURCE_STATUSES.has(status)) {
			return source;
		}

		if (status && FAILED_SOURCE_STATUSES.has(status)) {
			throw new Error(`Indexed PDF ${sourceId} failed with status ${status}`);
		}

		await wait(2_000);
	}

	throw new Error(`Indexed PDF ${sourceId} was not ready in time`);
}

function extractSourceItems(response: unknown): IndexedSource[] {
	if (Array.isArray(response)) {
		return response.filter(
			(entry): entry is IndexedSource =>
				typeof entry === "object" && entry !== null,
		);
	}

	if (
		typeof response === "object" &&
		response !== null &&
		"items" in response &&
		Array.isArray((response as { items?: unknown }).items)
	) {
		return (response as { items: IndexedSource[] }).items;
	}

	return [];
}

async function getUsableResearchPaperSourceId(
	indexTool: ReturnType<typeof createNiaIndexTool>,
): Promise<string> {
	const existingSources = extractSourceItems(
		await client.get("/sources", { type: "research_paper", limit: 10 }),
	);
	const readyExistingSource = existingSources.find((source) => {
		const status = source.status?.toLowerCase();
		return Boolean(source.id && status && READY_SOURCE_STATUSES.has(status));
	});

	if (readyExistingSource?.id) {
		return readyExistingSource.id;
	}

	const indexResult = await indexTool.execute(
		parseArgs(indexTool, {
			url: TEST_PDF_URL,
			source_type: "research_paper",
		}),
		createContext({ sessionID: "nia-document-agent-index" }),
	);

	expectNoClientError(indexResult);
	const indexed = JSON.parse(indexResult) as { source_id: string };
	expect(indexed.source_id).toBeTruthy();
	cleanupSourceIds.add(indexed.source_id);

	try {
		const readySource = await pollSourceReady(indexed.source_id);
		return readySource.id ?? indexed.source_id;
	} catch {
		return indexed.source_id;
	}
}

afterAll(async () => {
	const failures: string[] = [];

	for (const sourceId of cleanupSourceIds) {
		try {
			await client.sources.delete(sourceId);
		} catch (error) {
			failures.push(`${sourceId}: ${String(error)}`);
		}
	}

	cleanupSourceIds.clear();

	if (failures.length > 0) {
		throw new Error(
			`Failed to clean up live test sources: ${failures.join("; ")}`,
		);
	}
});

describeIfApiKey("nia_document_agent live API", () => {
	beforeAll(() => {
		assertApiConfigured();
	});

	it("indexes a PDF and exercises sync plus async document-agent endpoints", async () => {
		const indexTool = createNiaIndexTool(client, LIVE_CONFIG);
		const documentTool = createNiaDocumentAgentTool(client, LIVE_CONFIG);

		const indexStart = requestLog.length;
		const sourceId = await getUsableResearchPaperSourceId(indexTool);

		const indexCalls = sliceNewRequests(indexStart);
		const usedExistingSource = !indexCalls.some(
			(entry) => entry.path === "/sources" || entry.path === "/v2/sources",
		);
		if (!usedExistingSource) {
			const createSourceCall = indexCalls.find(
				(entry) => entry.path === "/sources" || entry.path === "/v2/sources",
			);
			expect(createSourceCall, "Expected a POST to /sources").toBeDefined();
		}

		const syncStart = requestLog.length;
		const syncArgs = parseArgs(documentTool, {
			action: "sync",
			source_id: sourceId,
			query: "What is the main contribution of this paper?",
		});
		const syncResult = await executeWithRetries(
			() =>
				documentTool.execute(
					syncArgs,
					createContext({ sessionID: "nia-document-agent-sync" }),
				),
			6,
			10_000,
		);

		expectNoClientError(syncResult);
		expect(syncResult).toContain("# Nia Document Agent");
		expect(syncResult).toContain("## Answer");

		const syncCalls = sliceNewRequests(syncStart);
		const syncCall = syncCalls.find(
			(entry) =>
				entry.path === "/document/agent" || entry.path === "/v2/document/agent",
		);
		expect(syncCall, "Expected a POST to /document/agent").toBeDefined();

		const asyncStart = requestLog.length;
		const submitArgs = parseArgs(documentTool, {
			action: "async_submit",
			source_id: sourceId,
			query: "Summarize the abstract in two bullets.",
		});
		const submitResult = await executeWithRetries(
			() =>
				documentTool.execute(
					submitArgs,
					createContext({ sessionID: "nia-document-agent-async" }),
				),
			6,
			10_000,
		);

		expectNoClientError(submitResult);
		const jobId = extractJobId(submitResult);
		expect(jobId, `Expected job id in async result: ${submitResult}`).toBeTruthy();

		const asyncCalls = sliceNewRequests(asyncStart);
		const asyncCreateCall = asyncCalls.find(
			(entry) =>
				entry.path === "/document/agent/jobs" ||
				entry.path === "/v2/document/agent/jobs",
		);
		expect(asyncCreateCall, "Expected a POST to /document/agent/jobs").toBeDefined();

		const statusStart = requestLog.length;
		const statusResult = await documentTool.execute(
			parseArgs(documentTool, {
				action: "async_status",
				job_id: jobId,
			}),
			createContext({ sessionID: "nia-document-agent-status" }),
		);

		if (!isMissingJobError(statusResult)) {
			expectNoClientError(statusResult);
			expect(statusResult).toContain(jobId!);
		}

		const statusCalls = sliceNewRequests(statusStart);
		const statusCall = statusCalls.find(
			(entry) =>
				entry.path === `/document/agent/jobs/${jobId}` ||
				entry.path === `/v2/document/agent/jobs/${jobId}`,
		);
		expect(
			statusCall,
			`Expected a GET to /document/agent/jobs/${jobId}`,
		).toBeDefined();

		const deleteStart = requestLog.length;
		const deleteResult = await documentTool.execute(
			parseArgs(documentTool, {
				action: "async_delete",
				job_id: jobId,
			}),
			createContext({ sessionID: "nia-document-agent-delete" }),
		);

		if (!isMissingJobError(deleteResult)) {
			expectNoClientError(deleteResult);
		}

		const deleteCalls = sliceNewRequests(deleteStart);
		const deleteCall = deleteCalls.find(
			(entry) =>
				(entry.path === `/document/agent/jobs/${jobId}` ||
					entry.path === `/v2/document/agent/jobs/${jobId}`) &&
				entry.method === "DELETE",
		);
		expect(
			deleteCall,
			`Expected a DELETE to /document/agent/jobs/${jobId}`,
		).toBeDefined();
	}, 240_000);

	it("returns a validation error when sync analysis is missing the query", async () => {
		const documentTool = createNiaDocumentAgentTool(client, LIVE_CONFIG);
		const result = await documentTool.execute(
			{ action: "sync", source_id: "paper_1" } as never,
			createContext(),
		);

		expect(result).toContain("validation_error");
		expect(result).toContain("query");
	}, 30_000);
});
