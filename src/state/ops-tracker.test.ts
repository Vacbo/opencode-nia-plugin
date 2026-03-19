import { describe, expect, it } from "bun:test";

import type { PendingOperation } from "../api/types.js";

import { OpsTracker } from "./ops-tracker.js";

describe("OpsTracker", () => {
  it("routes operations to the correct endpoints and drains completed work", async () => {
    const requests: string[] = [];
    const toasts: string[] = [];

    const responses = new Map<string, Record<string, unknown>>([
      ["/v2/repositories/repo-1", { status: "ready" }],
      ["/v2/data-sources/doc-1", { status: "ready" }],
      ["/v2/oracle/jobs/oracle-1", { status: "completed" }],
      ["/v2/github/tracer/tracer-1", { status: "completed" }],
    ]);

    const tracker = new OpsTracker({
      checkInterval: 15,
      client: {
        get: async <T>(path: string) => {
          requests.push(path);
          return responses.get(path) as T;
        },
      },
      ui: {
        showToast(message: string) {
          toasts.push(message);
        },
      },
    });

    const ops: PendingOperation[] = [
      { id: "repo-1", type: "index", name: "Repo index", sourceType: "repository" },
      { id: "doc-1", type: "index", name: "Docs index", sourceType: "data_source" },
      { id: "oracle-1", type: "oracle", name: "Oracle job" },
      { id: "tracer-1", type: "tracer", name: "Tracer job" },
    ];

    for (const op of ops) {
      tracker.trackOperation(op);
    }

    const completed = await tracker.checkAndDrain();

    expect(requests).toEqual([
      "/v2/repositories/repo-1",
      "/v2/data-sources/doc-1",
      "/v2/oracle/jobs/oracle-1",
      "/v2/github/tracer/tracer-1",
    ]);
    expect(completed.map((op) => op.id)).toEqual(["repo-1", "doc-1", "oracle-1", "tracer-1"]);
    expect(tracker.getAllOperations()).toHaveLength(0);
    expect(toasts).toHaveLength(4);
  });

  it("respects the rate limit between checks", async () => {
    let now = 10_000;
    let requestCount = 0;

    const tracker = new OpsTracker({
      checkInterval: 15,
      now: () => now,
      client: {
        get: async <T>() => {
          requestCount += 1;
          return ({ status: requestCount === 1 ? "processing" : "completed" } satisfies Record<string, unknown>) as T;
        },
      },
    });

    tracker.trackOperation({ id: "oracle-2", type: "oracle", name: "Long oracle job" });

    expect(await tracker.checkAndDrain()).toEqual([]);
    expect(requestCount).toBe(1);

    now += 14_000;
    expect(await tracker.checkAndDrain()).toEqual([]);
    expect(requestCount).toBe(1);

    now += 1_000;
    const completed = await tracker.checkAndDrain();
    expect(requestCount).toBe(2);
    expect(completed.map((op) => op.id)).toEqual(["oracle-2"]);
  });

  it("removes errored operations after surfacing a toast", async () => {
    const toasts: string[] = [];
    const tracker = new OpsTracker({
      checkInterval: 15,
      client: {
        get: async <T>() => ({ status: "error", error: "bad request" } satisfies Record<string, unknown>) as T,
      },
      ui: {
        showToast(message: string) {
          toasts.push(message);
        },
      },
    });

    tracker.trackOperation({ id: "tracer-2", type: "tracer", name: "Broken tracer" });

    expect(await tracker.checkAndDrain()).toEqual([]);
    expect(tracker.getOperation("tracer-2")).toBeUndefined();
    expect(toasts).toEqual(["Broken tracer failed: bad request"]);
  });
});
