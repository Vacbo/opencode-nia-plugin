import { tool } from "@opencode-ai/plugin";

import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";
import { createToolErrorFormatter } from "../utils/format.js";
import { resolveSource } from "./source-resolver.js";

const ABORT_ERROR = "abort_error [nia_mv]: request aborted";
const formatError = createToolErrorFormatter("mv");

function jsonResult(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function createNiaMvTool(client: SdkAdapter, config: NiaConfig) {
	return tool({
		description:
			"Move or rename a file in an indexed source's filesystem store.",
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
			old_path: tool.schema.string().describe("Existing file path"),
			new_path: tool.schema.string().describe("New file path"),
		},
		async execute(args, ctx) {
			try {
				if (ctx.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.searchEnabled) {
					return "config_error: nia mv is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const resolved = await resolveSource(client, args, ctx.abort);
				if (typeof resolved === "string") return resolved;

				const result = await client.post<unknown>(`/fs/${resolved.id}/mv`, {
					old_path: args.old_path,
					new_path: args.new_path,
				});

				return jsonResult({
					old_path: args.old_path,
					new_path: args.new_path,
					status: "moved",
					result: result ?? null,
				});
			} catch (error) {
				return formatError(error, ctx.abort.aborted);
			}
		},
	});
}
