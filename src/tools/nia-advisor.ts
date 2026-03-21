import { tool } from "@opencode-ai/plugin";

import type { NiaClient } from "../api/client.js";
import type {
	AdvisorOutputFormat,
	AdvisorResult,
	CodebaseContext,
	SearchScope,
} from "../api/types.js";
import type { NiaConfig } from "../config.js";

import { createToolErrorFormatter, inlineCode } from "../utils/format.js";

const formatUnexpectedError = createToolErrorFormatter("advisor");

const ABORT_ERROR = "abort_error [nia_advisor]: request aborted";
const z = tool.schema;

const niaAdvisorArgsShape = {
	query: z.string().trim().min(1, "query is required"),
	codebase: z
		.object({
			files: z.record(z.string(), z.string()).optional(),
			file_tree: z.string().optional(),
			dependencies: z.array(z.string()).optional(),
			git_diff: z.string().optional(),
			summary: z.string().optional(),
			focus_paths: z.array(z.string()).optional(),
		})
		.optional(),
	search_scope: z
		.object({
			repositories: z.array(z.string()).optional(),
			data_sources: z.array(z.string()).optional(),
		})
		.nullable()
		.optional(),
	output_format: z
		.enum(["explanation", "checklist", "diff", "structured"])
		.optional(),
};

export const niaAdvisorArgsSchema = tool.schema.object(niaAdvisorArgsShape);

export interface NiaAdvisorArgs {
	query: string;
	codebase?: CodebaseContext;
	search_scope?: SearchScope | null;
	output_format?: AdvisorOutputFormat;
}

export function createNiaAdvisorTool(client: NiaClient, config: NiaConfig) {
	return tool({
		description: "Get Nia advice for a query with markdown recommendations",
		args: niaAdvisorArgsShape,
		async execute(rawArgs, context) {
			try {
				const args = niaAdvisorArgsSchema.parse(rawArgs);
				if (context.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.advisorEnabled) {
					return "config_error: nia advisor is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const response = (await client.post(
					"/advisor",
					buildRequestBody(args),
					context.abort,
				)) as string | AdvisorResult;

				if (typeof response === "string") {
					return response;
				}

				return formatResponse(args, response);
			} catch (error) {
				return formatUnexpectedError(error, context.abort.aborted);
			}
		},
	});
}

function buildRequestBody(args: NiaAdvisorArgs): NiaAdvisorArgs {
	return {
		query: args.query,
		...(args.codebase ? { codebase: args.codebase } : {}),
		...(args.search_scope ? { search_scope: args.search_scope } : {}),
		...(args.output_format ? { output_format: args.output_format } : {}),
	};
}

function formatResponse(args: NiaAdvisorArgs, response: AdvisorResult): string {
	const sections = [
		"# Nia Advisor",
		`- Query: ${inlineCode(args.query)}`,
		...(args.codebase ? [`- Codebase context provided`] : []),
		...(args.search_scope
			? [`- Search scope: ${formatSearchScope(args.search_scope)}`]
			: []),
		...(args.output_format
			? [`- Requested output: ${inlineCode(args.output_format)}`]
			: []),
	];

	if (!response.advice || response.advice.trim() === "") {
		sections.push(
			`## Advice\nNo advice returned for ${inlineCode(args.query)}.`,
		);
		return sections.join("\n\n");
	}

	sections.push(`## Advice\n${response.advice}`);

	if (response.sources_searched && response.sources_searched.length > 0) {
		sections.push(
			`\n### Sources Searched\n${response.sources_searched.map(s => `- ${inlineCode(s)}`).join("\n")}`,
		);
	}

	return sections.join("\n\n");
}

function formatSearchScope(scope: SearchScope): string {
	const parts: string[] = [];
	if (scope.repositories && scope.repositories.length > 0) {
		parts.push(`repos: ${scope.repositories.join(", ")}`);
	}
	if (scope.data_sources && scope.data_sources.length > 0) {
		parts.push(`sources: ${scope.data_sources.join(", ")}`);
	}
	return parts.join(", ") || "custom";
}
