import { tool } from "@opencode-ai/plugin";

import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";
import {
	type NormalizedResult,
	createToolErrorFormatter,
	formatResults,
	inlineCode,
	stringOrFallback,
	truncateMarkdown,
} from "../utils/format.js";

type SearchResultItem = {
	id: string;
	source_id: string;
	source_type: string;
	title?: string;
	content: string;
	url?: string;
	file_path?: string;
	score: number;
	highlights?: string[];
};

type SearchMode = "universal" | "query" | "web" | "deep";

type UniversalSearchResponse = {
	results: SearchResultItem[];
	query: string;
	total: number;
};

type QuerySearchResponse = {
	answer: string;
	sources: SearchResultItem[];
	citations?: string[];
};

type WebSearchResponse = {
	results: Array<{
		title: string;
		url: string;
		snippet: string;
		score: number;
	}>;
	query: string;
};

type DeepSearchResponse = {
	id: string;
	status: "processing" | "completed" | "error";
	result?: string;
	sources?: SearchResultItem[];
	citations?: string[];
};

type SearchResponse =
	| UniversalSearchResponse
	| QuerySearchResponse
	| WebSearchResponse
	| DeepSearchResponse;

const MAX_NUM_RESULTS = 20;
const ABORT_ERROR = "abort_error [nia_search]: request aborted";
const z = tool.schema;

const niaSearchArgsShape = {
	query: z.string().trim().min(1, "query is required"),
	repositories: z.array(z.string().trim().min(1)).optional(),
	data_sources: z.array(z.string().trim().min(1)).optional(),
	search_mode: z
		.enum(["universal", "query", "web", "deep"])
		.default("universal"),
	max_tokens: z.number().int().positive().default(5000),
	include_sources: z.boolean().default(true),
	num_results: z.number().int().positive().max(MAX_NUM_RESULTS).default(10),
	e2e_session_id: z.string().trim().min(1).optional(),
	local_folders: z.array(z.string().trim().min(1)).optional(),
};

export const niaSearchArgsSchema = tool.schema.object(niaSearchArgsShape);

export interface NiaSearchArgs {
	query: string;
	repositories?: string[];
	data_sources?: string[];
	search_mode: SearchMode;
	max_tokens: number;
	include_sources: boolean;
	num_results: number;
	e2e_session_id?: string;
	local_folders?: string[];
}

export function createNiaSearchTool(client: SdkAdapter, config: NiaConfig) {
	return tool({
		description: "Search Nia across repos, docs, web, and research",
		args: niaSearchArgsShape,
		async execute(rawArgs, context) {
			try {
				const args = niaSearchArgsSchema.parse(rawArgs);
				if (context.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.searchEnabled) {
					return "config_error: nia search is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const response = (await client.post(
					"/search",
					buildRequestBody(args),
				)) as SearchResponse;

				return truncateMarkdown(
					formatResponse(args, response),
					args.max_tokens,
				);
			} catch (error) {
				return formatError(error, context.abort.aborted);
			}
		},
	});
}

function buildRequestBody(args: NiaSearchArgs): Record<string, unknown> {
	return {
		query: args.query,
		mode: args.search_mode,
		repositories: args.repositories,
		data_sources: args.data_sources,
		max_tokens: args.max_tokens,
		include_sources: args.include_sources,
		num_results: args.num_results,
		e2e_session_id: args.e2e_session_id,
		local_folders: args.local_folders,
	};
}

function formatResponse(args: NiaSearchArgs, response: SearchResponse): string {
	const sections = [
		"# Nia Search",
		`- Query: ${inlineCode(args.query)}`,
		`- Mode: ${inlineCode(args.search_mode)}`,
	];

	const answer = getAnswer(response);
	if (answer) {
		sections.push(`## Answer\n${answer}`);
	}

	const results = getNormalizedResults(response, "results");
	if (results.length > 0) {
		sections.push(`## Results\n${formatResults(results)}`);
	}

	const sources = args.include_sources
		? getNormalizedResults(response, "sources")
		: [];
	if (sources.length > 0) {
		sections.push(`## Sources\n${formatResults(sources)}`);
	}

	const citations = getStringArray(response, "citations");
	if (citations.length > 0) {
		sections.push(
			`## Citations\n${citations.map((citation) => `- ${citation}`).join("\n")}`,
		);
	}

	const status = getString(response, "status");
	if (status && status !== "completed") {
		sections.push(`## Status\n${status}`);
	}

	if (!answer && results.length === 0 && sources.length === 0) {
		sections.push(`No results found for ${inlineCode(args.query)}.`);
	}

	return sections.join("\n\n");
}

function getAnswer(response: SearchResponse): string | undefined {
	return getString(response, "answer") ?? getString(response, "result");
}

function getNormalizedResults(
	response: SearchResponse,
	key: "results" | "sources",
): NormalizedResult[] {
	const candidate = (response as unknown as Record<string, unknown>)[key];
	if (!Array.isArray(candidate)) {
		return [];
	}

	return candidate
		.map(normalizeResult)
		.filter((result): result is NormalizedResult => result !== undefined);
}

function normalizeResult(item: unknown): NormalizedResult | undefined {
	if (!item || typeof item !== "object") {
		return undefined;
	}

	const record = item as Partial<SearchResultItem> & {
		title?: string;
		snippet?: string;
		url?: string;
		file_path?: string;
		content?: string;
		source_type?: string;
		score?: number;
		highlights?: string[];
	};
	const title = stringOrFallback(
		record.title,
		record.file_path,
		record.url,
		"Untitled result",
	);
	const excerpt = stringOrFallback(
		record.content,
		record.snippet,
		"No excerpt available.",
	);

	return {
		title,
		excerpt,
		url: typeof record.url === "string" ? record.url : undefined,
		filePath:
			typeof record.file_path === "string" ? record.file_path : undefined,
		score: typeof record.score === "number" ? record.score : undefined,
		sourceType:
			typeof record.source_type === "string" ? record.source_type : undefined,
		highlights: Array.isArray(record.highlights)
			? record.highlights.filter(
					(value): value is string => typeof value === "string",
				)
			: undefined,
	};
}

function getString(input: unknown, key: string): string | undefined {
	if (!input || typeof input !== "object") {
		return undefined;
	}

	const value = (input as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function getStringArray(input: unknown, key: string): string[] {
	if (!input || typeof input !== "object") {
		return [];
	}

	const value = (input as Record<string, unknown>)[key];
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

export type { SearchMode };

const formatError = createToolErrorFormatter("search");
