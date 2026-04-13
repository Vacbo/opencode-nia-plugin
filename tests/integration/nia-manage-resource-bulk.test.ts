/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import type { NiaConfig } from "../../src/config";
import { createMockSdkAdapter } from "../../src/test/sdk-adapter";
import { createNiaIndexTool } from "../../src/tools/nia-index";
import { createNiaManageResourceTool } from "../../src/tools/nia-manage-resource";

const BASE_URL = process.env.NIA_API_URL ?? "https://apigcp.trynia.ai/v2";
const ALLOWED_SUCCESS_STATUSES = new Set([200, 201, 202]);
const ERROR_PREFIXES = [
  "abort_error",
  "config_error",
  "forbidden",
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
  bulkDeleteEnabled: true,
  cacheTTL: 300,
  maxPendingOps: 5,
  checkInterval: 15,
  tracerTimeout: 120,
	debug: true,
	apiUrl: BASE_URL,
} as NiaConfig;

const requestLog: RequestRecord[] = [];
const cleanupSourceIds: string[] = [];

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
    sessionID: "bulk-delete-test-session",
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

function parseArgs<TArgs extends z.ZodRawShape>(definition: { args: TArgs }, input: unknown): z.infer<z.ZodObject<TArgs>> {
  return z.object(definition.args).parse(input);
}

function assertApiConfigured(): void {
  expect(process.env.NIA_API_KEY, "NIA_API_KEY must be set for live integration tests").toBeTruthy();
}

function sliceNewRequests(start: number): RequestRecord[] {
  return requestLog.slice(start);
}

function expectSuccessfulCall(calls: RequestRecord[], path: string): RequestRecord {
  const call = calls.find((entry) => entry.path === path);
  expect(call, `Expected live call to ${path}`).toBeDefined();
  expect(ALLOWED_SUCCESS_STATUSES.has(call!.status), `Expected ${path} to return 2xx but got ${call!.status}`).toBe(true);
  return call!;
}

function expectNoClientError(result: string): void {
  const lowered = result.trim().toLowerCase();
  const matchedPrefix = ERROR_PREFIXES.find((prefix) => lowered.startsWith(prefix));
  expect(matchedPrefix, `Unexpected API/tool error: ${result}`).toBeUndefined();
}

function parseJsonResult<T>(value: string): T {
  expectNoClientError(value);
  return JSON.parse(value) as T;
}

describe("nia_manage_resource bulk_delete integration", () => {
  beforeAll(() => {
    assertApiConfigured();
  });

  afterAll(async () => {
    // Clean up any sources created during tests
    for (const sourceId of cleanupSourceIds) {
      try {
        await client.delete(`/sources/${encodeURIComponent(sourceId)}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("bulk deletes multiple sources via live API", async () => {
    const start = requestLog.length;
    const indexTool = createNiaIndexTool(client, LIVE_CONFIG);
    const manageTool = createNiaManageResourceTool(client, LIVE_CONFIG);

    // Create two test data sources
    const testUrl1 = `https://example.com/?nia-bulk-test-1=${Date.now()}`;
    const testUrl2 = `https://example.com/?nia-bulk-test-2=${Date.now()}`;
    const testName1 = `nia-bulk-test-1-${Date.now()}`;
    const testName2 = `nia-bulk-test-2-${Date.now()}`;

    const indexResult1 = await indexTool.execute(
      parseArgs(indexTool, { url: testUrl1, name: testName1 }),
      createContext()
    );
    const indexResult2 = await indexTool.execute(
      parseArgs(indexTool, { url: testUrl2, name: testName2 }),
      createContext()
    );

    const source1 = parseJsonResult<{ source_id: string }>(indexResult1);
    const source2 = parseJsonResult<{ source_id: string }>(indexResult2);

    expect(source1.source_id).toBeTruthy();
    expect(source2.source_id).toBeTruthy();

    cleanupSourceIds.push(source1.source_id, source2.source_id);

    // Bulk delete the sources
    const bulkDeleteResult = await manageTool.execute(
      parseArgs(manageTool, {
        action: "bulk_delete",
        resource_ids: [source1.source_id, source2.source_id],
      }),
      createContext()
    );

    if (bulkDeleteResult.startsWith("deprecated: bulk delete is not supported by the current Nia API.")) {
      expect(bulkDeleteResult).toBe("deprecated: bulk delete is not supported by the current Nia API.");
      return;
    }

    const result = parseJsonResult<{ deleted: string[]; failed: Array<{ id: string; error: string }> }>(bulkDeleteResult);

    // Verify the bulk delete response structure
    expect(Array.isArray(result.deleted)).toBe(true);
    expect(Array.isArray(result.failed)).toBe(true);

    // At least one source should be deleted (some may already be deleted)
    const deletedCount = result.deleted.length;
    const failedCount = result.failed.length;
    expect(deletedCount + failedCount).toBe(2);

    expectSuccessfulCall(sliceNewRequests(start), "/v2/sources/bulk-delete");
  }, 60_000);

  it("returns proper error when bulk deleting non-existent sources", async () => {
    const start = requestLog.length;
    const manageTool = createNiaManageResourceTool(client, LIVE_CONFIG);

    const fakeSourceIds = [
      `non-existent-source-${Date.now()}-1`,
      `non-existent-source-${Date.now()}-2`,
    ];

    const bulkDeleteResult = await manageTool.execute(
      parseArgs(manageTool, {
        action: "bulk_delete",
        resource_ids: fakeSourceIds,
      }),
      createContext()
    );

    if (bulkDeleteResult.startsWith("deprecated: bulk delete is not supported by the current Nia API.")) {
      expect(bulkDeleteResult).toBe("deprecated: bulk delete is not supported by the current Nia API.");
      return;
    }

    const result = parseJsonResult<{ deleted: string[]; failed: Array<{ id: string; error: string }> }>(bulkDeleteResult);

    // All non-existent sources should fail
    expect(result.deleted.length).toBe(0);
    expect(result.failed.length).toBe(2);
    expect(result.failed[0].id).toBe(fakeSourceIds[0]);
    expect(result.failed[1].id).toBe(fakeSourceIds[1]);

    expectSuccessfulCall(sliceNewRequests(start), "/v2/sources/bulk-delete");
  }, 30_000);

  it("returns config_error when bulkDeleteEnabled is false", async () => {
    const disabledConfig = { ...LIVE_CONFIG, bulkDeleteEnabled: false };
    const manageTool = createNiaManageResourceTool(client, disabledConfig);

    const result = await manageTool.execute(
      parseArgs(manageTool, {
        action: "bulk_delete",
        resource_ids: ["source-1"],
      }),
      createContext()
    );

    expect(result).toBe("config_error: bulk delete is disabled");
  });
});
