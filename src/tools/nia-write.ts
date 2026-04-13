import { tool } from "@opencode-ai/plugin";

import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";
import { createToolErrorFormatter } from "../utils/format.js";
import { resolveSource } from "./source-resolver.js";

const ABORT_ERROR = "abort_error [nia_write]: request aborted";
const formatError = createToolErrorFormatter("write");

function jsonResult(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function createNiaWriteTool(client: SdkAdapter, config: NiaConfig) {
	return tool({
		description:
			"Create or update a file in an indexed source's filesystem store. Supports utf8 and base64 encoding.",
		args: {
			source_id: tool.schema
				.string()
				.optional()
				.describe("Direct source ID. Use this OR source_type + identifier."),
				source_type: tool.schema
					.enum([
						"repository",
						"data_source",
						"documentation",
						"research_paper",
						"huggingface_dataset",
						"local_folder",
						"slack",
						"google_drive",
					])
					.optional()
					.describe(
						"Source type (repository, data_source, documentation, research_paper, huggingface_dataset, local_folder, slack, or google_drive)",
					),
			identifier: tool.schema
				.string()
				.optional()
				.describe("Source identifier (e.g. 'owner/repo' or docs URL)"),
			path: tool.schema.string().describe("File path to create or update"),
			body: tool.schema.string().describe("File content to write"),
			encoding: tool.schema
				.enum(["utf8", "base64"])
				.default("utf8")
				.describe("File content encoding"),
			language: tool.schema
				.string()
				.nullable()
				.optional()
				.describe("Optional programming language hint"),
			headers: tool.schema
				.record(tool.schema.string(), tool.schema.unknown())
				.nullable()
				.optional()
				.describe("Optional metadata headers object"),
		},
		async execute(args, ctx) {
			try {
				if (ctx.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.searchEnabled) {
					return "config_error: nia write is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const resolved = await resolveSource(client, args, ctx.abort);
				if (typeof resolved === "string") return resolved;

				const body = {
					path: args.path,
					body: args.body,
					encoding: args.encoding,
					language: args.language ?? null,
					headers: args.headers ?? null,
				};

				const result = await client.put<unknown>(`/fs/${resolved.id}/files`, body);

				return jsonResult({
					path: args.path,
					status: "written",
					result: result ?? null,
				});
			} catch (error) {
				return formatError(error, ctx.abort.aborted);
			}
		},
	});
}
