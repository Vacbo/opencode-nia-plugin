/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import { NiaClient, type FetchFn } from "../../src/api/client";
import NiaPlugin from "../../src/index";
import { NIA_NUDGE_MESSAGE } from "../../src/hooks/smart-triggers";
import { OpsTracker } from "../../src/state/ops-tracker";
import { resetSessionStates } from "../../src/state/session";
import type { NiaConfig } from "../../src/config";
import { createNiaIndexTool } from "../../src/tools/nia-index";
import { createNiaManageResourceTool } from "../../src/tools/nia-manage-resource";
import { createNiaSearchTool } from "../../src/tools/nia-search";

const TEST_CONFIG = { apiKey: "test-key", searchEnabled: true, researchEnabled: true, tracerEnabled: true, advisorEnabled: true, contextEnabled: true, e2eEnabled: true, cacheTTL: 300, maxPendingOps: 5, checkInterval: 15, tracerTimeout: 120, debug: false, triggersEnabled: true, apiUrl: "https://apigcp.trynia.ai/v2", keywords: { enabled: true, customPatterns: [] }, mcpServerName: "nia", mcpMaxRetries: 5, mcpReconnectBaseDelay: 100 } as NiaConfig;

type MockResponse = {
  status: number;
  body?: unknown;
  headers?: HeadersInit;
};

type MockHandler = (url: string, init: RequestInit) => MockResponse | Promise<MockResponse>;

const ALL_TOOL_NAMES = [
  "nia_search",
  "nia_read",
  "nia_grep",
  "nia_explore",
  "nia_index",
  "nia_manage_resource",
  "nia_research",
  "nia_advisor",
  "nia_context",
  "nia_package_search",
  "nia_auto_subscribe",
  "nia_tracer",
  "nia_e2e",
] as const;

const ALWAYS_ON_TOOL_NAMES = [
  "nia_search",
  "nia_read",
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

function createMockClient(responsesOrHandler: MockResponse[] | MockHandler): NiaClient {
  const pendingResponses = Array.isArray(responsesOrHandler) ? [...responsesOrHandler] : undefined;
  const handler = Array.isArray(responsesOrHandler) ? undefined : responsesOrHandler;
  const fetchFn: FetchFn = async (input, init) => {
    const requestInit = init ?? {};
    const nextResponse = pendingResponses
      ? pendingResponses.shift() ?? (() => {
          throw new Error(`Unexpected request for ${String(input)}`);
        })()
      : await handler!(String(input), requestInit);

    return new Response(nextResponse.body === undefined ? null : JSON.stringify(nextResponse.body), {
      status: nextResponse.status,
      headers: {
        "content-type": "application/json",
        ...nextResponse.headers,
      },
    });
  };

  return new NiaClient({
    apiKey: "test-key",
    baseUrl: "https://nia.test/v2",
    fetchFn,
  });
}

function createChatOutput(messageID: string, text: string) {
  return {
    message: { id: messageID },
    parts: [{ type: "text", text }],
  };
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

  it("registers all 13 tools and hooks when initialized with an API key", async () => {
    process.env.NIA_API_KEY = "test-key";

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);

    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([...ALL_TOOL_NAMES].sort());
    expect(typeof hooks["chat.message"]).toBe("function");
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
    process.env.NIA_TRACER = "false";
    process.env.NIA_E2E = "false";

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

      if (parsedUrl.pathname === "/v2/search/universal") {
        return { status: 200, body: { query: "bun docs", total: 0, results: [] } };
      }

      if (parsedUrl.pathname === "/v2/repositories") {
        return { status: 200, body: { source_id: "repo_1" } };
      }

      if (parsedUrl.pathname === "/v2/repositories/repo_1") {
        return { status: 200, body: { id: "repo_1", status: "ready" } };
      }

      throw new Error(`Unhandled request: ${method} ${parsedUrl.pathname}`);
    };

    const searchTool = createNiaSearchTool(createMockClient(handler) as unknown as NiaClient, TEST_CONFIG);
    const indexTool = createNiaIndexTool(createMockClient(handler) as unknown as NiaClient, TEST_CONFIG);
    const manageResourceTool = createNiaManageResourceTool(createMockClient(handler) as unknown as NiaClient, TEST_CONFIG);

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
          path: "/v2/search/universal",
          body: expect.objectContaining({ query: "bun docs" }),
        },
        {
          method: "POST",
          path: "/v2/repositories",
          body: { repository: "example/repo" },
        },
        {
          method: "GET",
          path: "/v2/repositories/repo_1",
          body: undefined,
        },
      ])
    );
  });

  it("fires smart triggers on research keywords", async () => {
    process.env.NIA_API_KEY = "test-key";

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);
    const output = createChatOutput("message-1", "please research the bun test docs");

    await hooks["chat.message"]?.({ sessionID: "session-1" } as never, output as never);

    expect(output.parts).toHaveLength(2);
    expect(output.parts[1]).toMatchObject({
      type: "text",
      text: NIA_NUDGE_MESSAGE,
      synthetic: true,
      sessionID: "session-1",
      messageID: "message-1",
    });
  });

  it("does not fire smart triggers for keywords inside code blocks", async () => {
    process.env.NIA_API_KEY = "test-key";

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);
    const output = createChatOutput(
      "message-2",
      "Here is code only:\n```ts\nresearch this library\nsearch for docs\n```"
    );

    await hooks["chat.message"]?.({ sessionID: "session-1" } as never, output as never);

    expect(output.parts).toHaveLength(1);
  });

  it("keeps session trigger state isolated between sessions", async () => {
    process.env.NIA_API_KEY = "test-key";

    const hooks = await NiaPlugin({ directory: "/tmp/project" } as never);
    const sessionOneFirst = createChatOutput("message-3", "research this library");
    const sessionOneSecond = createChatOutput("message-4", "search for more docs");
    const sessionTwoFirst = createChatOutput("message-5", "research this library");

    await hooks["chat.message"]?.({ sessionID: "session-1" } as never, sessionOneFirst as never);
    await hooks["chat.message"]?.({ sessionID: "session-1" } as never, sessionOneSecond as never);
    await hooks["chat.message"]?.({ sessionID: "session-2" } as never, sessionTwoFirst as never);

    expect(sessionOneFirst.parts).toHaveLength(2);
    expect(sessionOneSecond.parts).toHaveLength(1);
    expect(sessionTwoFirst.parts).toHaveLength(2);
    expect(sessionTwoFirst.parts[1]).toMatchObject({
      type: "text",
      text: NIA_NUDGE_MESSAGE,
      sessionID: "session-2",
      messageID: "message-5",
    });
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
