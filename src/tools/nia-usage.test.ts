import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import type { SdkAdapter } from "../api/nia-sdk";
import type { NiaConfig } from "../config";
import { createNiaUsageTool } from "./nia-usage";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, sandboxEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, annotationsEnabled: true, bulkDeleteEnabled: true, usageEnabled: true, feedbackEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] } } as NiaConfig;

function createContext(signal?: AbortSignal): ToolContext {
  const controller = new AbortController();
  return { sessionID: "session-1", messageID: "message-1", agent: "test", directory: "/tmp/project", worktree: "/tmp/project", abort: signal ?? controller.signal, metadata() {}, ask: async () => {} };
}

describe("nia_usage tool", () => {
  it("formats usage response as markdown", async () => {
    let capturedPath = "";
    const client = {
      get: async <T>(path: string) => {
        capturedPath = path;
        return { credits_used: 150, credits_remaining: 850, reset_date: "2026-05-01T00:00:00Z", plan: "pro" } as T;
      },
    };
    const niaUsageTool = createNiaUsageTool(client as unknown as SdkAdapter, TEST_CONFIG);
    const result = await niaUsageTool.execute({}, createContext());
    expect(capturedPath).toBe("/usage");
    expect(result).toContain("# Nia Usage");
    expect(result).toContain("## Quota Information");
    expect(result).toContain("Plan: `pro`");
    expect(result).toContain("Credits Used: 150");
    expect(result).toContain("Credits Remaining: 850");
    expect(result).toContain("Reset Date:");
  });

  it("formats date nicely", async () => {
    const client = {
      get: async <T>() => ({ credits_used: 0, credits_remaining: 1000, reset_date: "2026-12-25T00:00:00Z", plan: "free" } as T),
    };
    const niaUsageTool = createNiaUsageTool(client as unknown as SdkAdapter, TEST_CONFIG);
    const result = await niaUsageTool.execute({}, createContext());
    expect(result).toContain("December 25, 2026");
  });

  it("handles invalid date strings gracefully", async () => {
    const client = {
      get: async <T>() => ({ credits_used: 0, credits_remaining: 1000, reset_date: "invalid-date", plan: "free" } as T),
    };
    const niaUsageTool = createNiaUsageTool(client as unknown as SdkAdapter, TEST_CONFIG);
    const result = await niaUsageTool.execute({}, createContext());
    expect(result).toContain("Invalid Date");
  });

  for (const [status, text] of [["401", "bad key"], ["429", "slow down"], ["500", "upstream exploded"]] as const) {
    it(`returns HTTP ${status}: ${text} without throwing`, async () => {
      const niaUsageTool = createNiaUsageTool({ get: async () => { throw new Error(`HTTP ${status}: ${text}`); } } as unknown as SdkAdapter, TEST_CONFIG);
      const result = await niaUsageTool.execute({}, createContext());
      expect(result).toContain(`usage_error: HTTP ${status}: ${text}`);
    });
  }

  it("returns an abort string when the request signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const niaUsageTool = createNiaUsageTool({ get: async () => { throw new Error("should not reach client"); } } as unknown as SdkAdapter, TEST_CONFIG);
    const result = await niaUsageTool.execute({}, createContext(controller.signal));
    expect(result).toBe("abort_error [nia_usage]: request aborted");
  });

  it("returns config error when usage is disabled", async () => {
    const disabledConfig = { ...TEST_CONFIG, usageEnabled: false };
    const niaUsageTool = createNiaUsageTool({ get: async () => ({}) } as unknown as SdkAdapter, disabledConfig);
    const result = await niaUsageTool.execute({}, createContext());
    expect(result).toBe("config_error: nia usage is disabled");
  });

  it("returns config error when api key is not set", async () => {
    const noKeyConfig = { ...TEST_CONFIG, apiKey: undefined };
    const niaUsageTool = createNiaUsageTool({ get: async () => ({}) } as unknown as SdkAdapter, noKeyConfig);
    const result = await niaUsageTool.execute({}, createContext());
    expect(result).toBe("config_error: NIA_API_KEY is not set");
  });
});
