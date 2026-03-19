import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { ToolContext } from "@opencode-ai/plugin";

import { NiaClient, type FetchFn } from "../api/client";
import type { E2ESession } from "../api/types";
import { createNiaE2ETool } from "./nia-e2e";

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetchMock(handler: (url: string, init: RequestInit) => Response | Promise<Response>): FetchFn {
  return async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {});
}

function createClient(handler: (url: string, init: RequestInit) => Response | Promise<Response>): NiaClient {
  return new NiaClient({ apiKey: "nk_test", fetchFn: createFetchMock(handler) });
}

function createMockContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionID: "ses_1",
    messageID: "msg_1",
    agent: "test",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
    ...overrides,
  };
}

const SESSION_FIXTURE: E2ESession = {
  id: "e2e_ses_123",
  local_folder_id: "folder_123",
  expires_at: "2026-03-18T12:00:00Z",
  max_chunks: 50,
  allowed_operations: ["search", "read"],
};

describe("nia_e2e tool", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NIA_E2E;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("feature flag", () => {
    it("registers by default when NIA_E2E is unset", () => {
      const client = createClient(() => jsonResponse(200, SESSION_FIXTURE));

      expect(createNiaE2ETool(client)).toBeDefined();
    });

    it("returns undefined when NIA_E2E is disabled", () => {
      process.env.NIA_E2E = "false";
      const client = createClient(() => jsonResponse(200, SESSION_FIXTURE));

      expect(createNiaE2ETool(client)).toBeUndefined();
    });
  });

  describe("create_session action", () => {
    it("posts to /daemon/e2e/sessions with default values", async () => {
      let capturedUrl = "";
      let capturedBody = "";

      const client = createClient((url, init) => {
        capturedUrl = url;
        capturedBody = init.body as string;
        return jsonResponse(201, SESSION_FIXTURE);
      });

      const tool = createNiaE2ETool(client)!;
      const result = await tool.execute(
        { action: "create_session", local_folder_id: "folder_123" },
        createMockContext(),
      );

      expect(capturedUrl).toContain("/daemon/e2e/sessions");
      expect(JSON.parse(capturedBody)).toEqual({
        local_folder_id: "folder_123",
        ttl_seconds: 300,
        max_chunks: 50,
        allowed_operations: ["search", "read"],
      });
      expect(result).toContain("e2e_ses_123");
      expect(result).toContain("folder_123");
    });

    it("allows overriding ttl, max_chunks, and allowed_operations", async () => {
      let capturedBody = "";

      const client = createClient((_url, init) => {
        capturedBody = init.body as string;
        return jsonResponse(201, {
          ...SESSION_FIXTURE,
          max_chunks: 10,
          allowed_operations: ["read"],
        });
      });

      const tool = createNiaE2ETool(client)!;
      await tool.execute(
        {
          action: "create_session",
          local_folder_id: "folder_123",
          ttl_seconds: 120,
          max_chunks: 10,
          allowed_operations: ["read"],
        },
        createMockContext(),
      );

      expect(JSON.parse(capturedBody)).toEqual({
        local_folder_id: "folder_123",
        ttl_seconds: 120,
        max_chunks: 10,
        allowed_operations: ["read"],
      });
    });

    it("returns an error when local_folder_id is missing", async () => {
      const client = createClient(() => jsonResponse(200, {}));
      const tool = createNiaE2ETool(client)!;

      const result = await tool.execute({ action: "create_session" }, createMockContext());

      expect(result).toContain("error");
      expect(result).toContain("local_folder_id");
    });

    it("propagates validation failures", async () => {
      const client = createClient(() => jsonResponse(422, { message: "invalid local_folder_id" }));
      const tool = createNiaE2ETool(client)!;

      const result = await tool.execute(
        { action: "create_session", local_folder_id: "folder_123" },
        createMockContext(),
      );

      expect(result).toContain("validation_failed");
    });
  });

  describe("get_session action", () => {
    it("fetches /daemon/e2e/sessions/{session_id}", async () => {
      let capturedUrl = "";

      const client = createClient((url) => {
        capturedUrl = url;
        return jsonResponse(200, SESSION_FIXTURE);
      });

      const tool = createNiaE2ETool(client)!;
      const result = await tool.execute(
        { action: "get_session", session_id: "e2e_ses_123" },
        createMockContext(),
      );

      expect(capturedUrl).toContain("/daemon/e2e/sessions/e2e_ses_123");
      expect(result).toContain("e2e_ses_123");
      expect(result).toContain("search, read");
    });

    it("returns an error when session_id is missing", async () => {
      const client = createClient(() => jsonResponse(200, {}));
      const tool = createNiaE2ETool(client)!;

      const result = await tool.execute({ action: "get_session" }, createMockContext());

      expect(result).toContain("error");
      expect(result).toContain("session_id");
    });

    it("propagates not found responses", async () => {
      const client = createClient(() => jsonResponse(404, { message: "missing session" }));
      const tool = createNiaE2ETool(client)!;

      const result = await tool.execute(
        { action: "get_session", session_id: "missing" },
        createMockContext(),
      );

      expect(result).toContain("not_found");
    });
  });

  describe("purge action", () => {
    it("calls context.ask() before deleting source data", async () => {
      let askCalled = false;
      let deleteCalled = false;

      const client = createClient((url, init) => {
        deleteCalled = true;
        expect(url).toContain("/daemon/e2e/sources/source_123/data");
        expect(init.method).toBe("DELETE");
        return jsonResponse(200, { purged: true });
      });

      const tool = createNiaE2ETool(client)!;
      const result = await tool.execute(
        { action: "purge", source_id: "source_123" },
        createMockContext({
          ask: async () => {
            askCalled = true;
          },
        }),
      );

      expect(askCalled).toBe(true);
      expect(deleteCalled).toBe(true);
      expect(result).toContain("source_123");
      expect(result).toContain("purged");
    });

    it("does not call delete when permission is rejected", async () => {
      let deleteCalled = false;

      const client = createClient(() => {
        deleteCalled = true;
        return jsonResponse(200, { purged: true });
      });

      const tool = createNiaE2ETool(client)!;

      let error: Error | undefined;

      try {
        await tool.execute(
          { action: "purge", source_id: "source_123" },
          createMockContext({
            ask: async () => {
              throw new Error("permission denied");
            },
          }),
        );
      } catch (caught) {
        error = caught as Error;
      }

      expect(error?.message).toBe("permission denied");
      expect(deleteCalled).toBe(false);
    });

    it("returns an error when source_id is missing", async () => {
      const client = createClient(() => jsonResponse(200, {}));
      const tool = createNiaE2ETool(client)!;

      const result = await tool.execute({ action: "purge" }, createMockContext());

      expect(result).toContain("error");
      expect(result).toContain("source_id");
    });

    it("propagates API errors on purge", async () => {
      const client = createClient(() => jsonResponse(403, { message: "forbidden purge" }));
      const tool = createNiaE2ETool(client)!;

      const result = await tool.execute(
        { action: "purge", source_id: "source_123" },
        createMockContext(),
      );

      expect(result).toContain("forbidden");
    });
  });

  describe("sync action", () => {
    it("posts to /daemon/e2e/sync", async () => {
      let capturedUrl = "";
      let capturedBody = "";

      const client = createClient((url, init) => {
        capturedUrl = url;
        capturedBody = init.body as string;
        return jsonResponse(200, {
          local_folder_id: "folder_123",
          status: "queued",
          enqueued: 42,
        });
      });

      const tool = createNiaE2ETool(client)!;
      const result = await tool.execute(
        { action: "sync", local_folder_id: "folder_123" },
        createMockContext(),
      );

      expect(capturedUrl).toContain("/daemon/e2e/sync");
      expect(JSON.parse(capturedBody)).toEqual({ local_folder_id: "folder_123" });
      expect(result).toContain("queued");
      expect(result).toContain("folder_123");
    });

    it("returns an error when local_folder_id is missing", async () => {
      const client = createClient(() => jsonResponse(200, {}));
      const tool = createNiaE2ETool(client)!;

      const result = await tool.execute({ action: "sync" }, createMockContext());

      expect(result).toContain("error");
      expect(result).toContain("local_folder_id");
    });

    it("propagates rate limit errors", async () => {
      const client = createClient(() => jsonResponse(429, { message: "slow down" }));
      const tool = createNiaE2ETool(client)!;

      const result = await tool.execute(
        { action: "sync", local_folder_id: "folder_123" },
        createMockContext(),
      );

      expect(result).toContain("rate_limited");
    });
  });

  describe("invalid action", () => {
    it("returns an error for unknown actions", async () => {
      const client = createClient(() => jsonResponse(200, {}));
      const tool = createNiaE2ETool(client)!;

      const result = await tool.execute({ action: "unknown" as never }, createMockContext());

      expect(result).toContain("error");
      expect(result).toContain("unknown");
    });
  });
});
