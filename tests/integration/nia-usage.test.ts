/// <reference types="bun-types" />

import { beforeAll, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";

import type { NiaConfig } from "../../src/config";
import { createMockSdkAdapter } from "../../src/test/sdk-adapter";
import { createNiaUsageTool } from "../../src/tools/nia-usage";

const BASE_URL = process.env.NIA_API_URL ?? "https://apigcp.trynia.ai/v2";

const LIVE_CONFIG = {
  apiKey: process.env.NIA_API_KEY,
  searchEnabled: true,
  sandboxEnabled: true,
  researchEnabled: true,
  tracerEnabled: true,
  advisorEnabled: true,
  contextEnabled: true,
  e2eEnabled: true,
  usageEnabled: true,
  cacheTTL: 300,
  maxPendingOps: 5,
  checkInterval: 15,
  tracerTimeout: 120,
	debug: true,
	apiUrl: BASE_URL,
} as NiaConfig;

const requestLog: { method: string; path: string; status: number }[] = [];

const client = createMockSdkAdapter(async (url, init) => {
	const response = await fetch(url, init);
	requestLog.push({
		method: init.method ?? "GET",
		path: new URL(url).pathname,
		status: response.status,
	});
	return response;
}, BASE_URL);

function createContext(): ToolContext {
  return {
    sessionID: "usage-test-session",
    messageID: `message-${Date.now()}`,
    agent: "gpt-5.4",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

function assertApiConfigured(): void {
  expect(process.env.NIA_API_KEY, "NIA_API_KEY must be set for live integration tests").toBeTruthy();
}

describe("nia_usage integration", () => {
  beforeAll(() => {
    assertApiConfigured();
  });

  it("calls nia_usage against the live API", async () => {
    const start = requestLog.length;
    const usageTool = createNiaUsageTool(client, LIVE_CONFIG);
    const result = await usageTool.execute({}, createContext());

    expect(result).toContain("# Nia Usage");
    expect(result).toContain("## Subscription");
    expect(result).toContain("Tier:");
    expect(result).toContain("Billing Period End:");
    expect(result).toContain("## Usage");

    const calls = requestLog.slice(start);
    const usageCall = calls.find((entry) => entry.path === "/v2/usage");
    expect(usageCall, "Expected live call to /v2/usage").toBeDefined();
    expect(usageCall!.status).toBe(200);
  }, 30_000);
});
