import type { SSEEvent, SSEEventType } from "../api/types";

const MAX_BUFFER_SIZE = 5 * 1024 * 1024;

export type ReadableStreamReader<T> = {
  read(): Promise<{ done: boolean; value?: T }>;
  releaseLock(): void;
};

export async function* parseSSEStream(
  reader: ReadableStreamReader<Uint8Array>
): AsyncGenerator<SSEEvent, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType: SSEEventType = "content";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      if (buffer.trim()) {
        const event = parseLine(buffer, currentEventType);
        if (event) {
          yield event;
        }
      }
      break;
    }

    if (value === undefined) {
      continue;
    }

    buffer += decoder.decode(value, { stream: true });

    if (buffer.length > MAX_BUFFER_SIZE) {
      throw new Error(`SSE buffer exceeded ${MAX_BUFFER_SIZE} bytes`);
    }

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseLine(line, currentEventType);
      if (event) {
        if (event.type === "error" && event.error) {
          yield event;
        } else if (event.data !== undefined) {
          yield event;
        }
        if (event.type !== "content") {
          currentEventType = event.type;
        }
      }
    }
  }
}

function parseLine(line: string, defaultType: SSEEventType): SSEEvent | null {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith(":")) {
    return null;
  }

  if (trimmed.startsWith("event:")) {
    const eventType = trimmed.slice(6).trim();
    const validTypes: SSEEventType[] = ["thinking", "searching", "reading", "analyzing", "content", "done", "error"];
    if (validTypes.includes(eventType as SSEEventType)) {
      return { type: eventType as SSEEventType };
    }
    return null;
  }

  if (trimmed.startsWith("data:")) {
    const data = trimmed.slice(5).trim();
    if (!data) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = data;
    }

    const content = typeof parsed === "string" ? parsed : JSON.stringify(parsed);

    return {
      type: defaultType,
      data,
      content,
    };
  }

  return null;
}