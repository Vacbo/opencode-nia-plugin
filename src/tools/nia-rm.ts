import { tool } from "@opencode-ai/plugin";

import type { NiaClient } from "../api/client.js";
import type { NiaConfig } from "../config.js";
import { createToolErrorFormatter } from "../utils/format.js";
import { resolveSource } from "./source-resolver.js";

const ABORT_ERROR = "abort_error [nia_rm]: request aborted";
const formatError = createToolErrorFormatter("rm");

function jsonResult(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function createNiaRmTool(client: NiaClient, config: NiaConfig) {
	return tool({
		description:
			"Delete a file from an indexed source's filesystem store.",
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
					"x",
					"connector",
				])
				.optional()
				.describe(
					"Source type (repository, data_source, documentation, research_paper, huggingface_dataset, local_folder, slack, google_drive, x, or connector)",
				),
			identifier: tool.schema
				.string()
				.optional()
				.describe("Source identifier (e.g. 'owner/repo' or docs URL)"),
			path: tool.schema.string().describe("File path to delete"),
		},
		async execute(args, ctx) {
			try {
				if (ctx.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.searchEnabled) {
					return "config_error: nia rm is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const resolved = await resolveSource(client, args, ctx.abort);
				if (typeof resolved === "string") return resolved;

				const result = await client.delete<unknown>(
					`/fs/${resolved.id}/files?path=${encodeURIComponent(args.path)}`,
					undefined,
					ctx.abort,
				);

				if (typeof result === "string") return result;

				return jsonResult({
					path: args.path,
					status: "deleted",
					result: result ?? null,
				});
			} catch (error) {
				return formatError(error, ctx.abort.aborted);
			}
		},
	});
}
