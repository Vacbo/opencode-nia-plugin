import { describe, expect, it } from "bun:test";
import { parseSSEStream, type ReadableStreamReader } from "./sse-parser";

function createMockReader(chunks: string[]): ReadableStreamReader<Uint8Array> {
  let index = 0;
  const encoder = new TextEncoder();

  return {
    async read() {
      if (index >= chunks.length) {
        return { done: true };
      }
      const chunk = chunks[index];
      index += 1;
      return { done: false, value: encoder.encode(chunk) };
    },
    releaseLock() {},
  };
}

describe("parseSSEStream", () => {
  it("parses basic data lines", async () => {
    const reader = createMockReader(["data: hello\ndata: world\n"]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content", data: "hello", content: "hello" },
      { type: "content", data: "world", content: "world" },
    ]);
  });

  it("parses event type from event field", async () => {
    const reader = createMockReader([
      "event: thinking\ndata: analyzing\n",
      "event: done\ndata: complete\n",
    ]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "thinking", data: "analyzing", content: "analyzing" },
      { type: "done", data: "complete", content: "complete" },
    ]);
  });

  it("skips comments starting with :", async () => {
    const reader = createMockReader([": comment\ndata: hello\n: another\ndata: world\n"]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content", data: "hello", content: "hello" },
      { type: "content", data: "world", content: "world" },
    ]);
  });

  it("handles chunked delivery across multiple reads", async () => {
    const reader = createMockReader([
      "data: hel",
      "lo\ndata: wor",
      "ld\n",
    ]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content", data: "hello", content: "hello" },
      { type: "content", data: "world", content: "world" },
    ]);
  });

  it("parses JSON from data lines", async () => {
    const reader = createMockReader(["data: {\"key\":\"value\"}\n"]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content", data: '{"key":"value"}', content: '{"key":"value"}' },
    ]);
  });

  it("skips empty data lines", async () => {
    const reader = createMockReader(["data: hello\ndata:\ndata: world\n"]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content", data: "hello", content: "hello" },
      { type: "content", data: "world", content: "world" },
    ]);
  });

  it("handles trailing data without final newline", async () => {
    const reader = createMockReader(["data: hello\ndata: world"]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content", data: "hello", content: "hello" },
      { type: "content", data: "world", content: "world" },
    ]);
  });

  it("throws when buffer exceeds 5MB", async () => {
    const largeChunk = "x".repeat(5 * 1024 * 1024 + 1);
    const reader = createMockReader([largeChunk]);

    const iterator = parseSSEStream(reader);
    const promise = (async () => {
      for await (const _ of iterator) {
        // consume
      }
    })();

    expect(promise).rejects.toThrow("exceeded");
  });

  it("ignores unknown event types", async () => {
    const reader = createMockReader(["event: unknown\ndata: test\n"]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content", data: "test", content: "test" },
    ]);
  });

  it("handles empty input", async () => {
    const reader = createMockReader([]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([]);
  });

  it("handles whitespace-only lines", async () => {
    const reader = createMockReader(["   \ndata: hello\n  \ndata: world\n"]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content", data: "hello", content: "hello" },
      { type: "content", data: "world", content: "world" },
    ]);
  });

  it("preserves event type across multiple data lines", async () => {
    const reader = createMockReader([
      "event: thinking\n",
      "data: step1\n",
      "data: step2\n",
    ]);
    const events = [];
    for await (const event of parseSSEStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "thinking", data: "step1", content: "step1" },
      { type: "thinking", data: "step2", content: "step2" },
    ]);
  });
});