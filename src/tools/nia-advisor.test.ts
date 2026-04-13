import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import type { SdkAdapter } from "../api/nia-sdk";
import type { NiaConfig } from "../config";
import { createNiaAdvisorTool, niaAdvisorArgsSchema } from "./nia-advisor";

const TEST_CONFIG = { apiKey: "nk_test", searchEnabled: true, sandboxEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, annotationsEnabled: true, bulkDeleteEnabled: true, usageEnabled: true, feedbackEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] } } as NiaConfig;

function createContext(signal?: AbortSignal): ToolContext {
  const controller = new AbortController();
  return { sessionID: "session-1", messageID: "message-1", agent: "test", directory: "/tmp/project", worktree: "/tmp/project", abort: signal ?? controller.signal, metadata() {}, ask: async () => {} };
}

describe("nia_advisor tool", () => {
  it("formats advisor advice as markdown", async () => {
    let capturedPath = "";
    let capturedBody: Record<string, unknown> | undefined;
    const client = {
      post: async (path: string, body?: unknown) => {
        capturedPath = path;
        capturedBody = body as Record<string, unknown>;
        return { advice: "Add request-scoped retries with exponential backoff. Avoid leaking raw upstream errors to callers.", sources_searched: ["src/api/client.ts"], output_format: "explanation" };
      },
    };
		const niaAdvisorTool = createNiaAdvisorTool(client as unknown as SdkAdapter, TEST_CONFIG);
    const args = niaAdvisorArgsSchema.parse({ query: "How should I harden this API client?" });
    const result = await niaAdvisorTool.execute(args, createContext());
    expect(capturedPath).toBe("/advisor");
    expect(capturedBody).toEqual({ query: "How should I harden this API client?" });
    expect(result).toContain("# Nia Advisor");
    expect(result).toContain("## Advice");
    expect(result).toContain("Add request-scoped retries");
    expect(result).toContain("Sources Searched");
    expect(result).toContain("src/api/client.ts");
  });

  it("forwards optional params and includes them in markdown", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const niaAdvisorTool = createNiaAdvisorTool({
      post: async (_path: string, body?: unknown) => { capturedBody = body as Record<string, unknown>; return { advice: "Break the tool into request, formatting, and validation modules.", sources_searched: ["src/tools/nia-search.ts"], output_format: "checklist" }; },
		} as unknown as SdkAdapter, TEST_CONFIG);
    const result = await niaAdvisorTool.execute(niaAdvisorArgsSchema.parse({ query: "Recommend a refactor plan", codebase: { summary: "opencode-nia-plugin" }, search_scope: { repositories: ["repo"] }, output_format: "checklist" }), createContext());
    expect(capturedBody).toEqual({ query: "Recommend a refactor plan", codebase: { summary: "opencode-nia-plugin" }, search_scope: { repositories: ["repo"] }, output_format: "checklist" });
    expect(result).toContain("- Codebase context provided");
    expect(result).toContain("- Search scope: repos: repo");
    expect(result).toContain("- Requested output: `checklist`");
  });

  it("validates output_format enum rejects invalid values", async () => {
    const result = niaAdvisorArgsSchema.safeParse({ query: "test", output_format: "markdown" });
    expect(result.success).toBe(false);
  });

  it("accepts valid output_format enum values", async () => {
    for (const format of ["explanation", "checklist", "diff", "structured"] as const) {
      const result = niaAdvisorArgsSchema.safeParse({ query: "test", output_format: format });
      expect(result.success).toBe(true);
    }
  });

  for (const [status, text] of [["401", "bad key"], ["429", "slow down"], ["500", "upstream exploded"]] as const) {
    it(`returns HTTP ${status}: ${text} without throwing`, async () => {
		const niaAdvisorTool = createNiaAdvisorTool({ post: async () => { throw new Error(`HTTP ${status}: ${text}`); } } as unknown as SdkAdapter, TEST_CONFIG);
      const result = await niaAdvisorTool.execute(niaAdvisorArgsSchema.parse({ query: "What broke?" }), createContext());
      expect(result).toContain(`advisor_error: HTTP ${status}: ${text}`);
    });
  }

  it("returns an abort string when the request signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
		const niaAdvisorTool = createNiaAdvisorTool({ post: async () => { throw new Error("should not reach client"); } } as unknown as SdkAdapter, TEST_CONFIG);
    const result = await niaAdvisorTool.execute(niaAdvisorArgsSchema.parse({ query: "cancel me" }), createContext(controller.signal));
    expect(result).toBe("abort_error [nia_advisor]: request aborted");
  });
});
