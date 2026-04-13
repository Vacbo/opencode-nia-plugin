/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import type { SdkAdapter } from "../../src/api/nia-sdk";
import NiaPlugin from "../../src/index";
import { OpsTracker } from "../../src/state/ops-tracker";
import { resetSessionStates } from "../../src/state/session";
import type { NiaConfig } from "../../src/config";
import {
	createMockSdkAdapter,
	type MockHandler,
	type MockResponse,
} from "../../src/test/sdk-adapter";
import { createNiaIndexTool } from "../../src/tools/nia-index";
import { createNiaManageResourceTool } from "../../src/tools/nia-manage-resource";
import { createNiaSearchTool } from "../../src/tools/nia-search";

const TEST_CONFIG = { apiKey: "test-key", searchEnabled: true, sandboxEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, annotationsEnabled: true, bulkDeleteEnabled: true, usageEnabled: true, feedbackEnabled: true, documentAgentEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, apiUrl: "https://apigcp.trynia.ai/v2" } as NiaConfig;

const ALL_TOOL_NAMES = [
  "nia_search",
  "nia_read",
  "nia_write",
  "nia_rm",
  "nia_mv",
  "nia_mkdir",
  "nia_grep",
  "nia_explore",
  "nia_index",
  "nia_manage_resource",
  "nia_research",
  "nia_advisor",
  "nia_context",
  "nia_package_search",
  "nia_auto_subscribe",
  "nia_sandbox",
  "nia_tracer",
  "nia_e2e",
	"nia_usage",
	"nia_feedback",
	"nia_document_agent",
] as const;

const ALWAYS_ON_TOOL_NAMES = [
  "nia_search",
  "nia_read",
  "nia_write",
  "nia_rm",
  "nia_mv",
  "nia_mkdir",
  "nia_grep",
  "nia_explore",
  "nia_index",
  "nia_manage_resource",
  "nia_package_search",
  "nia_auto_subscribe",
] as const;

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
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

function createMockClient(responsesOrHandler: MockResponse[] | MockHandler): SdkAdapter {
	return createMockSdkAdapter(responsesOrHandler, "https://nia.test/v2");
}

describe("plugin lifecycle integration", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSessionStates();
  });

  it("registers all tools and hooks when initialized with an API key", async () => {
    process.env.NIA_API_KEY = "test-key";

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);

    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([...ALL_TOOL_NAMES].sort());
    expect(typeof hooks["tool.execute.after"]).toBe("function");
    expect(typeof hooks["experimental.chat.system.transform"]).toBe("function");
  });

  it("registers zero tools when initialized without an API key", async () => {
    delete process.env.NIA_API_KEY;

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);

    expect(hooks).toEqual({});
  });

  it("disables optional tools when feature flags are off", async () => {
    process.env.NIA_API_KEY = "test-key";
    process.env.NIA_RESEARCH = "false";
    process.env.NIA_ADVISOR = "false";
    process.env.NIA_CONTEXT = "false";
    process.env.NIA_SANDBOX_ENABLED = "false";
    process.env.NIA_TRACER = "false";
    process.env.NIA_E2E = "false";
    process.env.NIA_USAGE_ENABLED = "false";
    process.env.NIA_FEEDBACK_ENABLED = "false";
    process.env.NIA_DOCUMENT_AGENT_ENABLED = "false";

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);

    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([...ALWAYS_ON_TOOL_NAMES].sort());
  });

  it("simulates a batch lifecycle with three tools running in parallel", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const handler: MockHandler = async (url, init) => {
      const parsedUrl = new URL(url);
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;

      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      requests.push({ method, path: parsedUrl.pathname, body });
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;

		if (parsedUrl.pathname === "/v2/search") {
			return { status: 200, body: { query: "bun docs", total: 0, results: [] } };
		}

		if (parsedUrl.pathname === "/v2/sources") {
			return { status: 200, body: { source_id: "repo_1" } };
		}

		if (parsedUrl.pathname === "/v2/sources/repo_1") {
			return { status: 200, body: { id: "repo_1", status: "ready" } };
		}

      throw new Error(`Unhandled request: ${method} ${parsedUrl.pathname}`);
    };

		const searchTool = createNiaSearchTool(createMockClient(handler), TEST_CONFIG);
		const indexTool = createNiaIndexTool(createMockClient(handler), TEST_CONFIG);
		const manageResourceTool = createNiaManageResourceTool(createMockClient(handler), TEST_CONFIG);

    const [searchResult, indexResult, statusResult] = await Promise.all([
      searchTool.execute(parseArgs(searchTool, { query: "bun docs" }), createContext()),
      indexTool.execute(parseArgs(indexTool, { url: "https://github.com/example/repo" }), createContext()),
      manageResourceTool.execute(
        parseArgs(manageResourceTool, {
          action: "status",
          resource_type: "repository",
          resource_id: "repo_1",
        }),
        createContext()
      ),
    ]);

    expect(searchResult).toContain("# Nia Search");
    expect(JSON.parse(indexResult)).toMatchObject({ source_id: "repo_1", status: "queued" });
    expect(JSON.parse(statusResult)).toEqual({ id: "repo_1", status: "ready" });
    expect(maxInFlight).toBe(3);
		expect(requests).toEqual(
			expect.arrayContaining([
				{
					method: "POST",
					path: "/v2/search",
					body: expect.objectContaining({ query: "bun docs", mode: "universal" }),
				},
				{
					method: "POST",
					path: "/v2/sources",
					body: {
						type: "repository",
						url: "https://github.com/example/repo",
						repository: "example/repo",
					},
				},
				{
					method: "GET",
					path: "/v2/sources/repo_1",
					body: undefined,
				},
      ])
    );
  });

  it("drives async notification flow through OpsTracker with an injected client", async () => {
    const toasts: string[] = [];
    const tracker = new OpsTracker({
      checkInterval: 0,
      client: createMockClient([
        {
          status: 200,
          body: { status: "completed", progress: 100 },
        },
      ]),
      ui: {
        showToast(message: string) {
          toasts.push(message);
        },
      },
    });

    tracker.trackOperation({ id: "job-1", type: "tracer", name: "Tracer smoke" });

    const completed = await tracker.checkAndDrain();

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ id: "job-1", status: "completed", progress: 100 });
    expect(tracker.getAllOperations()).toEqual([]);
    expect(toasts).toEqual(["Tracer smoke completed"]);
  });
});
