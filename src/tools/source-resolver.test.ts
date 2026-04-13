import { describe, expect, it } from "bun:test";

import {
	createMatchedResponseHandler,
	createResponseSdkAdapter,
} from "../test/sdk-adapter.js";
import { resolveSource } from "./source-resolver.js";

function createClient(
	handlers: Array<{ match: string; response: unknown; status?: number }>,
) {
	return createResponseSdkAdapter(createMatchedResponseHandler(handlers));
}

describe("resolveSource", () => {
	it("returns error when source_id provided without source_type", async () => {
		const client = createClient([]);

		const result = await resolveSource(client, { source_id: "repo-1" });

		expect(typeof result).toBe("string");
		expect(result).toContain("validation_error");
		expect(result).toContain("source_type");
		expect(result).toContain("source_id");
	});

	it("resolves source_id with repository type", async () => {
		const client = createClient([]);

		const result = await resolveSource(client, {
			source_id: "repo-123",
			source_type: "repository",
		});

		expect(result).toEqual({
			id: "repo-123",
			type: "repository",
		});
	});

	it("normalizes data_source inputs to documentation", async () => {
		const client = createClient([]);

		const result = await resolveSource(client, {
			source_id: "ds-456",
			source_type: "data_source",
		});

		expect(result).toEqual({
			id: "ds-456",
			type: "documentation",
		});
	});

	it("resolves source_id with google_drive type", async () => {
		const client = createClient([]);

		const result = await resolveSource(client, {
			source_id: "drive-789",
			source_type: "google_drive",
		});

		expect(result).toEqual({
			id: "drive-789",
			type: "google_drive",
		});
	});

	it("returns error for unknown source_type", async () => {
		const client = createClient([]);

		const result = await resolveSource(client, {
			source_id: "some-id",
			source_type: "invalid_type" as never,
		});

		expect(typeof result).toBe("string");
		expect(result).toContain("validation_error");
		expect(result).toContain("unknown source_type");
	});

	it("resolves via identifier when source_type + identifier provided", async () => {
		let capturedUrl = "";
		const client = createResponseSdkAdapter(async (url) => {
			capturedUrl = url;
			return new Response(
				JSON.stringify({
					sources: [
						{ id: "resolved-id", type: "repository", repository: "owner/repo" },
					],
					total: 1,
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});

		const result = await resolveSource(client, {
			source_type: "repository",
			identifier: "owner/repo",
		});

		expect(capturedUrl).toContain("/sources");
		expect(capturedUrl).toContain("type=repository");
		expect(capturedUrl).toContain("query=owner%2Frepo");
		expect(result).toEqual({
			id: "resolved-id",
			type: "repository",
		});
	});

	it("returns documentation when identifier lookup uses data_source", async () => {
		let capturedUrl = "";
		const client = createResponseSdkAdapter(async (url) => {
			capturedUrl = url;
			return new Response(
				JSON.stringify({ sources: [{ id: "doc-123" }], total: 1 }),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});

		const result = await resolveSource(client, {
			source_type: "data_source",
			identifier: "https://docs.example.com",
		});

		expect(capturedUrl).toContain("type=documentation");
		expect(result).toEqual({ id: "doc-123", type: "documentation" });
	});

	it("returns error when neither source_id nor identifier provided", async () => {
		const client = createClient([]);

		const result = await resolveSource(client, { source_type: "repository" });

		expect(typeof result).toBe("string");
		expect(result).toContain("validation_error");
		expect(result).toContain("source_id");
	});
});
