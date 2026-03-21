import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { NiaClient, type FetchFn } from "./client";

function jsonResponse(status: number, body?: unknown, headers: HeadersInit = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function createFetchMock(
  steps: Array<Response | Error | ((url: string, init: RequestInit) => Response | Promise<Response>)>
): FetchFn {
  let index = 0;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;

    if (step instanceof Error) {
      throw step;
    }

    if (typeof step === "function") {
      return await step(String(input), init ?? {});
    }

    return step instanceof Response ? step.clone() : step;
  };
}

describe("NiaClient", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("uses NIA_API_URL when baseUrl is omitted", async () => {
    process.env.NIA_API_URL = "https://custom.nia.test/v2";
    let requestUrl = "";

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        (url) => {
          requestUrl = url;
          return jsonResponse(200, { ok: true });
        },
      ]),
    });

    const result = await client.get<{ ok: boolean }>("/health");

    expect(result).toEqual({ ok: true });
    expect(requestUrl).toBe("https://custom.nia.test/v2/health");
  });

  it("builds GET query strings and forwards auth headers", async () => {
    const controller = new AbortController();
    let requestUrl = "";
    let requestInit: RequestInit | undefined;

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        (url, init) => {
          requestUrl = url;
          requestInit = init;
          return jsonResponse(200, { ok: true });
        },
      ]),
    });

    const result = await client.get<{ ok: boolean }>(
      "/sources",
      { limit: 10, search: "abc", active: true },
      controller.signal
    );

    expect(result).toEqual({ ok: true });
    expect(requestUrl).toBe("https://apigcp.trynia.ai/v2/sources?limit=10&search=abc&active=true");
    expect(requestInit?.method).toBe("GET");
    expect(requestInit?.headers).toMatchObject({
      Authorization: "Bearer nia-key",
      Accept: "application/json",
    });
    expect(requestInit?.signal).toBeDefined();
  });

  it("serializes POST JSON bodies", async () => {
    let requestInit: RequestInit | undefined;

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        (_url, init) => {
          requestInit = init;
          return jsonResponse(201, { id: "ctx_1" });
        },
      ]),
    });

    const result = await client.post<{ id: string }>("/contexts", { title: "Doc" });

    expect(result).toEqual({ id: "ctx_1" });
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify({ title: "Doc" }));
    expect(requestInit?.headers).toMatchObject({
      "Content-Type": "application/json",
    });
  });

  it("serializes PATCH JSON bodies", async () => {
    let requestInit: RequestInit | undefined;

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        (_url, init) => {
          requestInit = init;
          return jsonResponse(200, { updated: true });
        },
      ]),
    });

    const result = await client.patch<{ updated: boolean }>("/contexts/ctx_1", { title: "Renamed" });

    expect(result).toEqual({ updated: true });
    expect(requestInit?.method).toBe("PATCH");
    expect(requestInit?.body).toBe(JSON.stringify({ title: "Renamed" }));
  });

  it("serializes DELETE JSON bodies", async () => {
    let requestInit: RequestInit | undefined;

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        (_url, init) => {
          requestInit = init;
          return jsonResponse(200, { deleted: true });
        },
      ]),
    });

    const result = await client.delete<{ deleted: boolean }>("/contexts/ctx_1", { hard: true });

    expect(result).toEqual({ deleted: true });
    expect(requestInit?.method).toBe("DELETE");
    expect(requestInit?.body).toBe(JSON.stringify({ hard: true }));
  });

  it("maps 401 responses to an unauthorized error string", async () => {
    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([jsonResponse(401, { message: "bad key" })]),
    });

    const result = await client.get("/sources");

    expect(result).toContain("unauthorized");
    expect(result).toContain("401");
    expect(result).toContain("bad key");
  });

  it("maps 403 responses to a forbidden error string", async () => {
    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([jsonResponse(403, { error: "forbidden" })]),
    });

    const result = await client.get("/sources");

    expect(result).toContain("forbidden");
    expect(result).toContain("403");
  });

  it("maps 404 responses to a not found error string", async () => {
    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([jsonResponse(404, { message: "missing" })]),
    });

    const result = await client.get("/missing");

    expect(result).toContain("not_found");
    expect(result).toContain("404");
    expect(result).toContain("missing");
  });

  it("maps 422 responses to a validation error string", async () => {
    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        jsonResponse(422, { message: "invalid payload", details: { field: "query" } }),
      ]),
    });

    const result = await client.post("/query", { query: "" });

    expect(result).toContain("validation_failed");
    expect(result).toContain("422");
    expect(result).toContain("invalid payload");
    expect(result).toContain("field");
  });

  it("retries 429 responses and succeeds", async () => {
    let calls = 0;

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        () => {
          calls += 1;
          return jsonResponse(429, { message: "slow down" }, { "Retry-After": "0" });
        },
        () => {
          calls += 1;
          return jsonResponse(429, { message: "still slow" }, { "Retry-After": "0" });
        },
        () => {
          calls += 1;
          return jsonResponse(200, { ok: true });
        },
      ]),
    });

    const result = await client.get<{ ok: boolean }>("/sources");

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("includes rate limit headers after exhausting 429 retries", async () => {
    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        jsonResponse(429, { message: "slow down" }, {
          "Retry-After": "0",
          "X-RateLimit-Limit": "100",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": "1700000000",
        }),
      ]),
    });

    const result = await client.get("/sources");

    expect(result).toContain("rate_limited");
    expect(result).toContain("retry-after=0");
    expect(result).toContain("limit=100");
    expect(result).toContain("remaining=0");
    expect(result).toContain("reset=1700000000");
  });

  it("retries 500 responses and eventually succeeds", async () => {
    let calls = 0;

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        () => {
          calls += 1;
          return jsonResponse(500, { message: "temporary" });
        },
        () => {
          calls += 1;
          return jsonResponse(200, { ok: true });
        },
      ]),
    });

    const result = await client.get<{ ok: boolean }>("/sources");

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("retries 503 responses and eventually succeeds", async () => {
    let calls = 0;

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        () => {
          calls += 1;
          return jsonResponse(503, { message: "maintenance" });
        },
        () => {
          calls += 1;
          return jsonResponse(200, { ok: true });
        },
      ]),
    });

    const result = await client.get<{ ok: boolean }>("/sources");

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("returns a network error string when fetch rejects", async () => {
    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([new Error("socket hang up")]),
    });

    const result = await client.get("/sources");

    expect(result).toContain("network_error");
    expect(result).toContain("socket hang up");
  });

  it("returns an abort error string when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([jsonResponse(200, { ok: true })]),
    });

    const result = await client.get("/sources", undefined, controller.signal);

    expect(result).toContain("abort_error");
  });

  it("passes abort signals through to fetch", async () => {
    let capturedSignal: AbortSignal | null = null;

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        (_url, init) => {
          capturedSignal = init.signal as AbortSignal;
          return jsonResponse(200, { ok: true });
        },
      ]),
    });

    const controller = new AbortController();
    const result = await client.get<{ ok: boolean }>("/sources", undefined, controller.signal);

    expect(result).toEqual({ ok: true });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).not.toBeNull();
  });

  it("returns a timeout error string when a request exceeds its timeout", async () => {
    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), {
            once: true,
          });
        }),
    });

    const result = await client.get("/sources", undefined, undefined, 10);

    expect(result).toContain("timeout_error");
    expect(result).toContain("10ms");
  });

  it("uses the injected fetch implementation instead of the ambient global fetch", async () => {
    let injectedCalls = 0;
    globalThis.fetch = (async () => jsonResponse(500, { message: "should not run" })) as unknown as typeof fetch;

    const client = new NiaClient({
      apiKey: "nia-key",
      fetchFn: createFetchMock([
        () => {
          injectedCalls += 1;
          return jsonResponse(200, { ok: true });
        },
      ]),
    });

    const result = await client.get<{ ok: boolean }>("/sources");

    expect(result).toEqual({ ok: true });
    expect(injectedCalls).toBe(1);
  });

  describe("stream", () => {
    function sseResponse(body: string): Response {
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }

    it("yields SSE events from stream", async () => {
      const client = new NiaClient({
        apiKey: "nia-key",
        fetchFn: createFetchMock([
          sseResponse("data: hello\ndata: world\n"),
        ]),
      });

      const events = [];
      for await (const event of client.stream("/oracle/jobs/job_123")) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "content", data: "hello", content: "hello" },
        { type: "content", data: "world", content: "world" },
      ]);
    });

    it("parses event type from event: field", async () => {
      const client = new NiaClient({
        apiKey: "nia-key",
        fetchFn: createFetchMock([
          sseResponse("event: thinking\ndata: analyzing...\nevent: done\ndata: complete\n"),
        ]),
      });

      const events = [];
      for await (const event of client.stream("/oracle/jobs/job_123")) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "thinking", data: "analyzing...", content: "analyzing..." },
        { type: "done", data: "complete", content: "complete" },
      ]);
    });

    it("sends Accept: text/event-stream header", async () => {
      let requestInit: RequestInit | undefined;

      const client = new NiaClient({
        apiKey: "nia-key",
        fetchFn: createFetchMock([
          (_url, init) => {
            requestInit = init;
            return sseResponse("");
          },
        ]),
      });

      for await (const _ of client.stream("/oracle/jobs/job_123")) {
        // consume
      }

      expect(requestInit?.headers).toMatchObject({
        Accept: "text/event-stream",
        Authorization: "Bearer nia-key",
      });
    });

    it("includes query params in URL", async () => {
      let requestUrl = "";

      const client = new NiaClient({
        apiKey: "nia-key",
        fetchFn: createFetchMock([
          (url) => {
            requestUrl = url;
            return sseResponse("");
          },
        ]),
      });

      for await (const _ of client.stream("/oracle/jobs", { status: "pending" })) {
        // consume
      }

      expect(requestUrl).toContain("status=pending");
    });

    it("yields error event on non-ok response", async () => {
      const client = new NiaClient({
        apiKey: "nia-key",
        fetchFn: createFetchMock([
          jsonResponse(500, { error: "server error" }),
        ]),
      });

      const events = [];
      for await (const event of client.stream("/oracle/jobs/job_123")) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      expect(events[0].error).toContain("500");
    });

    it("yields error event when response body is null", async () => {
      const client = new NiaClient({
        apiKey: "nia-key",
        fetchFn: createFetchMock([
          () => new Response(null, { status: 200 }),
        ]),
      });

      const events = [];
      for await (const event of client.stream("/oracle/jobs/job_123")) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      expect(events[0].error).toContain("null");
    });

    it("supports abort signal", async () => {
      const controller = new AbortController();

      const client = new NiaClient({
        apiKey: "nia-key",
        fetchFn: createFetchMock([
          sseResponse("data: start\n"),
        ]),
      });

      const events = [];
      for await (const event of client.stream("/oracle/jobs/job_123", undefined, controller.signal)) {
        events.push(event);
        controller.abort();
      }

      expect(events[0].type).toBe("content");
      expect(events[1].type).toBe("error");
      expect(events[1].error).toContain("abort");
    });

    it("skips empty data lines", async () => {
      const client = new NiaClient({
        apiKey: "nia-key",
        fetchFn: createFetchMock([
          sseResponse("data: hello\ndata:\ndata: world\n"),
        ]),
      });

      const events = [];
      for await (const event of client.stream("/oracle/jobs/job_123")) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "content", data: "hello", content: "hello" },
        { type: "content", data: "world", content: "world" },
      ]);
    });

    it("handles trailing data without newline", async () => {
      const client = new NiaClient({
        apiKey: "nia-key",
        fetchFn: createFetchMock([
          sseResponse("data: hello\ndata: world"),
        ]),
      });

      const events = [];
      for await (const event of client.stream("/oracle/jobs/job_123")) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "content", data: "hello", content: "hello" },
        { type: "content", data: "world", content: "world" },
      ]);
    });
  });
});
