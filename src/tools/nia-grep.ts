import { tool } from "@opencode-ai/plugin";
import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";
import { createToolErrorFormatter } from "../utils/format.js";
import { resolveSource } from "./source-resolver.js";

type GrepResultItem = {
	path: string;
	line_number: number;
	content: string;
	context_before?: string[];
	context_after?: string[];
};

const MAX_MATCHES = 100;
const ABORT_ERROR = "abort_error [nia_grep]: request aborted";

export function createNiaGrepTool(client: SdkAdapter, config: NiaConfig) {
	return tool({
		description:
			"Search for code patterns in a Nia-indexed repository via grep. " +
			"Returns matching lines with optional context. Truncated at 100 matches.",
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
				.describe("Source identifier (e.g. 'owner/repo')"),
			pattern: tool.schema
				.string()
				.describe("Search pattern (regex or literal)"),
			context_lines: tool.schema
				.number()
				.optional()
				.describe("Lines of context around each match"),
			case_sensitive: tool.schema
				.boolean()
				.optional()
				.describe("Case-sensitive search (default: true)"),
		},
		async execute(args, ctx) {
			try {
				if (ctx.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.searchEnabled) {
					return "config_error: nia grep is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const resolved = await resolveSource(client, args, ctx.abort);
				if (typeof resolved === "string") return resolved;

				const body: Record<string, unknown> = { pattern: args.pattern };
				if (args.context_lines !== undefined)
					body.context_lines = args.context_lines;
				if (args.case_sensitive !== undefined)
					body.case_sensitive = args.case_sensitive;

				const result = await client.post<GrepResultItem[]>(
					`/fs/${resolved.id}/grep`,
					body,
				);

				if (!result || result.length === 0) {
					return `No matches found for pattern: \`${args.pattern}\``;
				}

				const totalMatches = result.length;
				const truncated = totalMatches > MAX_MATCHES;
				const matches = truncated ? result.slice(0, MAX_MATCHES) : result;

				const lines = matches.map((m) => {
					const before = m.context_before?.length
						? `${m.context_before.map((l) => `  ${l}`).join("\n")}\n`
						: "";
					const after = m.context_after?.length
						? `\n${m.context_after.map((l) => `  ${l}`).join("\n")}`
						: "";
					return `${before}**${m.path}:${m.line_number}** ${m.content}${after}`;
				});

				const header =
					`## Grep: \`${args.pattern}\`\n` +
					`**Matches:** ${totalMatches}${truncated ? ` (showing first ${MAX_MATCHES})` : ""}`;

				return `${header}\n\n${lines.join("\n\n")}`;
			} catch (error) {
				return formatError(error, ctx.abort.aborted);
			}
		},
	});
}

const formatError = createToolErrorFormatter("grep");
