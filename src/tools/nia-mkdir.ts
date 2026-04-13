import { tool } from "@opencode-ai/plugin";

import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";
import { createToolErrorFormatter } from "../utils/format.js";
import { resolveSource } from "./source-resolver.js";

const ABORT_ERROR = "abort_error [nia_mkdir]: request aborted";
const formatError = createToolErrorFormatter("mkdir");

function jsonResult(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function createNiaMkdirTool(client: SdkAdapter, config: NiaConfig) {
	return tool({
		description:
			"Create a directory in an indexed source's filesystem store.",
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
			path: tool.schema.string().describe("Directory path to create"),
		},
		async execute(args, ctx) {
			try {
				if (ctx.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.searchEnabled) {
					return "config_error: nia mkdir is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const resolved = await resolveSource(client, args, ctx.abort);
				if (typeof resolved === "string") return resolved;

				const body = { path: args.path };

				const result = await client.post<unknown>(`/fs/${resolved.id}/mkdir`, body);

				return jsonResult({
					path: args.path,
					status: "created",
					result: result ?? null,
				});
			} catch (error) {
				return formatError(error, ctx.abort.aborted);
			}
		},
	});
}
