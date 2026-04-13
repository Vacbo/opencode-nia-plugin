/// <reference types="bun-types" />

import { beforeAll, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import type { NiaConfig } from "../../src/config";
import { createMockSdkAdapter } from "../../src/test/sdk-adapter";
import { createNiaFeedbackTool } from "../../src/tools/nia-feedback";

const BASE_URL = process.env.NIA_API_URL ?? "https://apigcp.trynia.ai/v2";
const ALLOWED_SUCCESS_STATUSES = new Set([200, 201, 202, 204]);
const ERROR_PREFIXES = [
  "abort_error",
  "config_error",
  "feedback_error",
  "forbidden",
  "network_error",
  "not_found",
  "rate_limited",
  "server_error",
  "service_unavailable",
  "timeout_error",
  "unauthorized",
  "validation_error",
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
  feedbackEnabled: true,
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
    sessionID: "feedback-integration-session",
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

describe("nia_feedback integration", () => {
  beforeAll(() => {
    assertApiConfigured();
  });

  it("calls nia_feedback answer action against the live API", async () => {
    const start = requestLog.length;
    const feedbackTool = createNiaFeedbackTool(client, LIVE_CONFIG);
    const result = await feedbackTool.execute(
      parseArgs(feedbackTool, {
        action: "answer",
        answer_id: "test-answer-123",
        feedback_type: "thumbs_up",
        comment: "Integration test feedback",
      }),
      createContext()
    );

    expectNoClientError(result);
    expect(result).toContain("Feedback submitted successfully");
    expectSuccessfulCall(sliceNewRequests(start), "/v2/feedback/answer");
  }, 30_000);

  it("calls nia_feedback source action against the live API", async () => {
    const start = requestLog.length;
    const feedbackTool = createNiaFeedbackTool(client, LIVE_CONFIG);
    const result = await feedbackTool.execute(
      parseArgs(feedbackTool, {
        action: "source",
        source_id: "test-source-456",
        feedback_type: "helpful",
        comment: "Great documentation source",
      }),
      createContext()
    );

    expectNoClientError(result);
    expect(result).toContain("Feedback submitted successfully");
    expectSuccessfulCall(sliceNewRequests(start), "/v2/feedback/source");
  }, 30_000);

  it("calls nia_feedback interaction action against the live API", async () => {
    const start = requestLog.length;
    const feedbackTool = createNiaFeedbackTool(client, LIVE_CONFIG);
    const result = await feedbackTool.execute(
      parseArgs(feedbackTool, {
        action: "interaction",
        interaction_id: "test-interaction-789",
        feedback_type: "navigated",
      }),
      createContext()
    );

    expectNoClientError(result);
    expect(result).toContain("Interaction signal submitted successfully");
    expectSuccessfulCall(sliceNewRequests(start), "/v2/feedback/interaction");
  }, 30_000);

  it("submits feedback with metadata against the live API", async () => {
    const start = requestLog.length;
    const feedbackTool = createNiaFeedbackTool(client, LIVE_CONFIG);
    const result = await feedbackTool.execute(
      parseArgs(feedbackTool, {
        action: "answer",
        answer_id: "test-answer-metadata",
        feedback_type: "thumbs_down",
        comment: "Missing key details",
        metadata: '{"reason": "incomplete", "missing_sections": ["examples", "edge_cases"]}',
      }),
      createContext()
    );

    expectNoClientError(result);
    expect(result).toContain("Feedback submitted successfully");
    expectSuccessfulCall(sliceNewRequests(start), "/v2/feedback/answer");
  }, 30_000);
});
