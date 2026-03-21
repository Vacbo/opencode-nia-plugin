import { tool } from "@opencode-ai/plugin";
import type { NiaClient } from "../api/client.js";
import type {
	RepositoryTreeNode,
	RepositoryTreeResponse,
} from "../api/types.js";
import type { NiaConfig } from "../config.js";
import { createToolErrorFormatter } from "../utils/format.js";
import { resolveSource } from "./source-resolver.js";

const ABORT_ERROR = "abort_error [nia_explore]: request aborted";

function formatTree(nodes: RepositoryTreeNode[], indent = ""): string {
	const lines: string[] = [];
	for (const node of nodes) {
		const icon = node.type === "directory" ? "\u{1F4C1}" : "\u{1F4C4}";
		const size = node.size !== undefined ? ` (${node.size}B)` : "";
		lines.push(`${indent}${icon} ${node.path}${size}`);
		if (node.children?.length) {
			lines.push(formatTree(node.children, indent + "  "));
		}
	}
	return lines.join("\n");
}

export function createNiaExploreTool(client: NiaClient, config: NiaConfig) {
	return tool({
		description:
			"Explore the file tree of a Nia-indexed repository or data source. " +
			"Returns directory structure with optional depth limit.",
		args: {
			source_id: tool.schema
				.string()
				.optional()
				.describe("Direct source ID. Use this OR source_type + identifier."),
			source_type: tool.schema
				.enum(["repository", "data_source"])
				.optional()
				.describe("Source type"),
			identifier: tool.schema
				.string()
				.optional()
				.describe("Source identifier (e.g. 'owner/repo')"),
			path: tool.schema
				.string()
				.optional()
				.describe("Subtree path to explore (default: root)"),
			max_depth: tool.schema
				.number()
				.optional()
				.describe("Maximum directory depth to return"),
		},
		async execute(args, ctx) {
			try {
				if (ctx.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.searchEnabled) {
					return "config_error: nia explore is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const resolved = await resolveSource(client, args, ctx.abort);
				if (typeof resolved === "string") return resolved;

				const params: Record<string, string | number> = {};
				if (args.path) params.path = args.path;
				if (args.max_depth !== undefined) params.max_depth = args.max_depth;

				const result = await client.get<RepositoryTreeResponse>(
					`/${resolved.endpoint}/${resolved.id}/tree`,
					params,
					ctx.abort,
				);

				if (typeof result === "string") return result;

				if (!result.tree || result.tree.length === 0) {
					return `No files found${args.path ? ` at path: ${args.path}` : ""}`;
				}

				const header = `## File Tree: ${result.repository}${result.branch ? ` (${result.branch})` : ""}`;
				const pathInfo = args.path ? `\n**Path:** ${args.path}` : "";
				const tree = formatTree(result.tree);

				return `${header}${pathInfo}\n\n${tree}`;
			} catch (error) {
				return formatError(error, ctx.abort.aborted);
			}
		},
	});
}

const formatError = createToolErrorFormatter("explore");
