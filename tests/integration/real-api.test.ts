/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import { NiaClient, type FetchFn } from "../../src/api/client";
import type { NiaConfig } from "../../src/config";
import { createNiaAdvisorTool } from "../../src/tools/nia-advisor";
import { createNiaIndexTool } from "../../src/tools/nia-index";
import { createNiaManageResourceTool } from "../../src/tools/nia-manage-resource";
import { createNiaResearchTool } from "../../src/tools/nia-research";
import { createNiaSearchTool } from "../../src/tools/nia-search";

const BASE_URL = process.env.NIA_API_URL ?? "https://apigcp.trynia.ai/v2";
const TEST_DATA_SOURCE_URL = `https://example.com/?nia-live-test=${Date.now()}`;
const TEST_DATA_SOURCE_NAME = `nia-live-test-${Date.now()}`;
const ALLOWED_SUCCESS_STATUSES = new Set([200, 201, 202]);
const ERROR_PREFIXES = [
  "abort_error",
  "advisor_error",
  "config_error",
  "forbidden",
  "network_error",
  "not_found",
  "rate_limited",
  "search_error",
  "server_error",
  "service_unavailable",
  "timeout_error",
  "unauthorized",
  "validation_error",
  "validation_failed",
] as const;

type DataSourceRecord = {
  id?: string;
  url?: string;
  display_name?: string;
  status?: string;
};

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
const cleanupDataSourceIds = new Set<string>();
let baselineDataSourceIds = new Set<string>();

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
    sessionID: "real-api-session",
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

function expectCallStatus(calls: RequestRecord[], path: string, status: number): RequestRecord {
  const call = calls.find((entry) => entry.path === path);
  expect(call, `Expected live call to ${path}`).toBeDefined();
  expect(call!.status).toBe(status);
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

function toResourceIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    throw new Error(`Expected resource list to be an array, received ${typeof value}`);
  }

  return new Set(
    value
      .map((entry) => (entry && typeof entry === "object" && typeof (entry as DataSourceRecord).id === "string" ? (entry as DataSourceRecord).id : undefined))
      .filter((entry): entry is string => Boolean(entry))
  );
}

async function listDataSources(): Promise<DataSourceRecord[]> {
  const response = await client.get<DataSourceRecord[]>("/data-sources");
  if (typeof response === "string") {
    throw new Error(`Unable to list data sources before live test cleanup setup: ${response}`);
  }

  if (!Array.isArray(response)) {
    throw new Error("Live /data-sources response was not an array");
  }

  return response;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollDataSourceStatus(sourceId: string): Promise<DataSourceRecord> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await client.get<DataSourceRecord>(`/data-sources/${encodeURIComponent(sourceId)}`);
    if (typeof response !== "string") {
      return response;
    }

    if (!response.startsWith("not_found")) {
      throw new Error(`Unable to fetch data source ${sourceId}: ${response}`);
    }

    await wait(1_500);
  }

  throw new Error(`Data source ${sourceId} was not available after polling`);
}

describe("real Nia API integration", () => {
  beforeAll(async () => {
    assertApiConfigured();
    baselineDataSourceIds = toResourceIds(await listDataSources());
  });

  afterAll(async () => {
    const failures: string[] = [];

    for (const dataSourceId of cleanupDataSourceIds) {
      const response = await client.delete(`/data-sources/${encodeURIComponent(dataSourceId)}`);
      if (typeof response === "string" && !response.startsWith("not_found")) {
        failures.push(`${dataSourceId}: ${response}`);
      }
    }

    cleanupDataSourceIds.clear();

    if (failures.length > 0) {
      throw new Error(`Failed to clean up live test data sources: ${failures.join("; ")}`);
    }
  });

  it("calls nia_search against the live API", async () => {
    const start = requestLog.length;
    const searchTool = createNiaSearchTool(client, LIVE_CONFIG);
    const result = await searchTool.execute(
      parseArgs(searchTool, {
        query: "Bun test documentation",
        search_mode: "web",
        include_sources: true,
        num_results: 3,
        max_tokens: 1500,
      }),
      createContext()
    );

    expectNoClientError(result);
    expect(result).toContain("# Nia Search");
    expect(result).toContain("- Mode: `web`");
    expect(result).toContain("- Query: `Bun test documentation`");
    expectSuccessfulCall(sliceNewRequests(start), "/v2/search/web");
  }, 60_000);

  it("calls nia_research quick mode against the live API", async () => {
    const start = requestLog.length;
    const researchTool = createNiaResearchTool(client, LIVE_CONFIG);
    const result = await researchTool.execute(
      parseArgs(researchTool, {
        query: "What is Bun test and where are its docs?",
        mode: "quick",
        num_results: 3,
      }),
      createContext()
    );

    expectNoClientError(result);
    expect(result).toContain("# Nia Research");
    expect(result).toContain("- Mode: `quick`");
    expectSuccessfulCall(sliceNewRequests(start), "/v2/search/web");
  }, 60_000);

  it("calls nia_manage_resource list against the live API", async () => {
    const start = requestLog.length;
    const manageTool = createNiaManageResourceTool(client, LIVE_CONFIG);
    const result = await manageTool.execute(parseArgs(manageTool, { action: "list" }), createContext());
    const parsed = parseJsonResult<{ repositories: unknown; data_sources: unknown }>(result);

    expect(Array.isArray(parsed.repositories)).toBe(true);
    expect(Array.isArray(parsed.data_sources)).toBe(true);

    const calls = sliceNewRequests(start);
    expectSuccessfulCall(calls, "/v2/repositories");
    expectSuccessfulCall(calls, "/v2/data-sources");
  }, 60_000);

  it("surfaces the current nia_advisor live API contract mismatch", async () => {
    const start = requestLog.length;
    const advisorTool = createNiaAdvisorTool(client, LIVE_CONFIG);
    const result = await advisorTool.execute(
      parseArgs(advisorTool, {
        query: "How should I validate live API integration tests for a TypeScript plugin?",
        codebase: "opencode-nia-plugin",
        output_format: "checklist",
      }),
      createContext()
    );

    expect(result).toContain("validation_failed [422]");
    expect(result).toContain("codebase");
    expectCallStatus(sliceNewRequests(start), "/v2/advisor", 422);
  }, 60_000);

  it("calls nia_index and validates the indexed data source status", async () => {
    const start = requestLog.length;
    const indexTool = createNiaIndexTool(client, LIVE_CONFIG);
    const manageTool = createNiaManageResourceTool(client, LIVE_CONFIG);

    const indexResult = await indexTool.execute(
      parseArgs(indexTool, { url: TEST_DATA_SOURCE_URL, name: TEST_DATA_SOURCE_NAME }),
      createContext({ sessionID: "real-api-index-session" })
    );
    const indexed = parseJsonResult<{ source_id: string; source_type: string; status: string }>(indexResult);

    expect(indexed.source_id).toBeTruthy();
    expect(indexed.source_type).toBe("data_source");
    expect(indexed.status).toBe("queued");
    expectSuccessfulCall(sliceNewRequests(start), "/v2/data-sources");

    if (!baselineDataSourceIds.has(indexed.source_id)) {
      cleanupDataSourceIds.add(indexed.source_id);
    }

    const dataSource = await pollDataSourceStatus(indexed.source_id);
    expect(dataSource.id).toBe(indexed.source_id);
    expect(typeof dataSource.status).toBe("string");

    const statusStart = requestLog.length;
    const statusResult = await manageTool.execute(
      parseArgs(manageTool, {
        action: "status",
        resource_type: "data_source",
        resource_id: indexed.source_id,
      }),
      createContext()
    );
    const parsedStatus = parseJsonResult<DataSourceRecord>(statusResult);

    expect(parsedStatus.id).toBe(indexed.source_id);
    expect(typeof parsedStatus.status).toBe("string");
    expectSuccessfulCall(sliceNewRequests(statusStart), `/v2/data-sources/${indexed.source_id}`);
  }, 120_000);
});
