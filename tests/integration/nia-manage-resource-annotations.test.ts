/// <reference types="bun-types" />

import { beforeAll, describe, expect, it } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";

import type { SdkAdapter } from "../../src/api/nia-sdk";
import type { NiaConfig } from "../../src/config";
import { createNiaManageResourceTool } from "../../src/tools/nia-manage-resource";

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
  annotationsEnabled: true,
  cacheTTL: 300,
  maxPendingOps: 5,
  checkInterval: 15,
  tracerTimeout: 120,
  debug: true,
  triggersEnabled: true,
  apiUrl: BASE_URL,
  keywords: { enabled: true, customPatterns: [] },
} as NiaConfig;

const requestLog: { method: string; path: string; status: number }[] = [];

function createMockSdkAdapter(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  baseUrl: string,
): SdkAdapter {
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const url = new URL(path, baseUrl);
    const response = await fetchImpl(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LIVE_CONFIG.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  };

  return {
    search: {
      universal: async () => { throw new Error("not implemented"); },
      query: async () => { throw new Error("not implemented"); },
      web: async () => { throw new Error("not implemented"); },
      deep: async () => { throw new Error("not implemented"); },
    },
    sources: {
      create: async () => { throw new Error("not implemented"); },
      list: async () => { throw new Error("not implemented"); },
      resolve: async () => { throw new Error("not implemented"); },
      get: async () => { throw new Error("not implemented"); },
      update: async () => { throw new Error("not implemented"); },
      delete: async () => { throw new Error("not implemented"); },
    },
    oracle: {
      createJob: async () => { throw new Error("not implemented"); },
      getJob: async () => { throw new Error("not implemented"); },
      waitForJob: async () => { throw new Error("not implemented"); },
      streamJob: async function* () { yield { error: "not implemented" }; throw new Error("not implemented"); },
    },
    tracer: {
      createJob: async () => { throw new Error("not implemented"); },
      streamJob: async function* () { yield { error: "not implemented" }; throw new Error("not implemented"); },
    },
    sandbox: {
      createJob: async () => { throw new Error("not implemented"); },
      getJob: async () => { throw new Error("not implemented"); },
      streamJob: async function* () { yield { error: "not implemented" }; throw new Error("not implemented"); },
    },
    contexts: {
      create: async () => { throw new Error("not implemented"); },
      list: async () => { throw new Error("not implemented"); },
      get: async () => { throw new Error("not implemented"); },
      update: async () => { throw new Error("not implemented"); },
      delete: async () => { throw new Error("not implemented"); },
      semanticSearch: async () => { throw new Error("not implemented"); },
    },
    packages: {
      search: async () => { throw new Error("not implemented"); },
    },
    dependencies: {
      analyze: async () => { throw new Error("not implemented"); },
      subscribe: async () => { throw new Error("not implemented"); },
    },
    advisor: {
      ask: async () => { throw new Error("not implemented"); },
    },
    filesystem: {
      read: async () => { throw new Error("not implemented"); },
      write: async () => { throw new Error("not implemented"); },
      grep: async () => { throw new Error("not implemented"); },
      tree: async () => { throw new Error("not implemented"); },
      mkdir: async () => { throw new Error("not implemented"); },
      mv: async () => { throw new Error("not implemented"); },
      rm: async () => { throw new Error("not implemented"); },
    },
    daemon: {
      createSource: async () => { throw new Error("not implemented"); },
      listSources: async () => { throw new Error("not implemented"); },
      createE2ESession: async () => { throw new Error("not implemented"); },
      getE2ESessionStatus: async () => { throw new Error("not implemented"); },
      decryptE2EChunks: async () => { throw new Error("not implemented"); },
    },
    get: async <T>(path: string) => request<T>("GET", path),
    post: async <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: async <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    patch: async <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    delete: async <T>(path: string) => request<T>("DELETE", path),
  };
}

const client = createMockSdkAdapter(async (url, init) => {
  const response = await fetch(url, init);
  requestLog.push({
    method: init.method ?? "GET",
    path: new URL(url).pathname,
    status: response.status,
  });
  return response;
}, BASE_URL);

function parseArgs<TArgs extends z.ZodRawShape>(
  definition: { args: TArgs },
  input: unknown,
): z.infer<z.ZodObject<TArgs>> {
  return z.object(definition.args).parse(input);
}

function createContext(): ToolContext {
  return {
    sessionID: "annotations-test-session",
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

describe("nia_manage_resource annotations integration", () => {
  beforeAll(() => {
    assertApiConfigured();
  });

  it("creates, lists, and deletes annotations on a source", async () => {
    // First, we need to find or create a source to annotate
    // For this test, we'll try to list existing sources and use the first one
    const listResponse = await fetch(new URL("/v2/sources?limit=1", BASE_URL).toString(), {
      headers: { Authorization: `Bearer ${LIVE_CONFIG.apiKey}` },
    });

    expect(listResponse.status).toBe(200);
    const sources = await listResponse.json() as Array<{ id: string; name: string }>;
    expect(sources.length).toBeGreaterThan(0);

    const sourceId = sources[0].id;
    const start = requestLog.length;

    const tool = createNiaManageResourceTool(client, LIVE_CONFIG);

    // Create an annotation
    const createResult = await tool.execute(
      parseArgs(tool, {
        action: "annotation_create",
        resource_type: "repository",
        resource_id: sourceId,
        content: "Test annotation from integration test",
      }),
      createContext(),
    );

    const createData = JSON.parse(createResult);
    expect(createData).toHaveProperty("id");
    expect(createData).toHaveProperty("content");
    const annotationId = createData.id;

    // List annotations
    const listResult = await tool.execute(
      parseArgs(tool, {
        action: "annotation_list",
        resource_type: "repository",
        resource_id: sourceId,
      }),
      createContext(),
    );

    const listData = JSON.parse(listResult);
    expect(Array.isArray(listData)).toBe(true);
    expect(listData.some((ann: { id: string }) => ann.id === annotationId)).toBe(true);

    // Delete the annotation
    const deleteResult = await tool.execute(
      parseArgs(tool, {
        action: "annotation_delete",
        resource_type: "repository",
        resource_id: sourceId,
        annotation_id: annotationId,
      }),
      createContext(),
    );

    const deleteData = JSON.parse(deleteResult);
    expect(deleteData).toHaveProperty("deleted", true);

    // Verify the calls were made
    const calls = requestLog.slice(start);
    const createCall = calls.find((entry) => entry.path === `/v2/sources/${sourceId}/annotations` && entry.method === "POST");
    const listCall = calls.find((entry) => entry.path === `/v2/sources/${sourceId}/annotations` && entry.method === "GET");
    const deleteCall = calls.find((entry) => entry.path === `/v2/sources/${sourceId}/annotations/${annotationId}` && entry.method === "DELETE");

    expect(createCall).toBeDefined();
    expect(listCall).toBeDefined();
    expect(deleteCall).toBeDefined();
    expect(createCall!.status).toBe(200);
    expect(listCall!.status).toBe(200);
    expect(deleteCall!.status).toBe(200);
  }, 60_000);
});
