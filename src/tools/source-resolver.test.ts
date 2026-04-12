import { describe, expect, it } from "bun:test";

import { NiaClient, type FetchFn } from "../api/client.js";
import { resolveSource } from "./source-resolver.js";

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(
  handlers: Array<{ match: string; response: unknown; status?: number }>,
): FetchFn {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const h of handlers) {
      if (url.includes(h.match)) {
        return jsonResponse(h.status ?? 200, h.response);
      }
    }
    return jsonResponse(404, { message: "not found" });
  };
}

describe("resolveSource", () => {
  it("returns error when source_id provided without source_type", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([]),
    });

    const result = await resolveSource(client, { source_id: "repo-1" });

    expect(typeof result).toBe("string");
    expect(result).toContain("validation_error");
    expect(result).toContain("source_type");
    expect(result).toContain("source_id");
  });

  it("resolves source_id with repository type", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([]),
    });

		const result = await resolveSource(client, {
			source_id: "repo-123",
			source_type: "repository",
		});

		expect(typeof result).toBe("object");
		expect(result).toEqual({
			id: "repo-123",
			type: "repository",
		});
	});

  it("resolves source_id with data_source type", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([]),
    });

		const result = await resolveSource(client, {
			source_id: "ds-456",
			source_type: "data_source",
		});

		expect(typeof result).toBe("object");
		expect(result).toEqual({
			id: "ds-456",
			type: "data_source",
		});
	});

	it("resolves source_id with google_drive type", async () => {
		const client = new NiaClient({
			apiKey: "k",
			fetchFn: mockFetch([]),
		});

		const result = await resolveSource(client, {
			source_id: "drive-789",
			source_type: "google_drive",
		});

		expect(typeof result).toBe("object");
		expect(result).toEqual({
			id: "drive-789",
			type: "google_drive",
		});
	});

  it("returns error for unknown source_type", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([]),
    });

    const result = await resolveSource(client, {
      source_id: "some-id",
      source_type: "invalid_type",
    });

    expect(typeof result).toBe("string");
    expect(result).toContain("validation_error");
    expect(result).toContain("unknown source_type");
  });

  it("resolves via identifier when source_type + identifier provided", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([
        {
          match: "/sources",
          response: {
            sources: [{ id: "resolved-id", type: "repository", repository: "owner/repo" }],
            total: 1,
          },
        },
      ]),
    });

		const result = await resolveSource(client, {
			source_type: "repository",
			identifier: "owner/repo",
		});

		expect(typeof result).toBe("object");
		expect(result).toEqual({
			id: "resolved-id",
			type: "repository",
		});
	});

  it("returns error when neither source_id nor identifier provided", async () => {
    const client = new NiaClient({
      apiKey: "k",
      fetchFn: mockFetch([]),
    });

    const result = await resolveSource(client, { source_type: "repository" });

    expect(typeof result).toBe("string");
    expect(result).toContain("validation_error");
    expect(result).toContain("source_id");
  });
});
