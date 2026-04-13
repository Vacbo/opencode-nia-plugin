import { tool } from "@opencode-ai/plugin";

import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";
import { getSessionState } from "../state/session.js";
import { createToolErrorFormatter } from "../utils/format.js";

const ABORT_ERROR = "abort_error [nia_index]: request aborted";
const formatError = createToolErrorFormatter("index");

export type IndexSourceType = "repository" | "data_source" | "research_paper";

type IndexResponse = {
	id?: string;
	source_id?: string;
};

const SOURCE_TYPE_SCHEMA = tool.schema.enum([
	"repository",
	"data_source",
	"research_paper",
]);
const URL_SCHEMA = tool.schema.string().refine((value) => {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}, "Invalid URL");

const PAPER_HOSTS = new Set([
	"arxiv.org",
	"doi.org",
	"openreview.net",
	"papers.nips.cc",
	"aclanthology.org",
	"ieeexplore.ieee.org",
	"dl.acm.org",
]);

export function detectSourceType(url: string): IndexSourceType {
	const parsed = new URL(url);
	const hostname = parsed.hostname.toLowerCase();
	const pathname = parsed.pathname.toLowerCase();

	if (
		hostname === "github.com" &&
		parsed.pathname.split("/").filter(Boolean).length >= 2
	) {
		return "repository";
	}

	if (PAPER_HOSTS.has(hostname) || pathname.endsWith(".pdf")) {
		return "research_paper";
	}

	return "data_source";
}

function normalizeRepositoryUrl(url: string): string {
	const parsed = new URL(url);
	const parts = parsed.pathname.split("/").filter(Boolean);

	if (parsed.hostname.toLowerCase() !== "github.com" || parts.length < 2) {
		return url;
	}

	return `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
}

function buildRequestBody(args: {
	url: string;
	source_type?: IndexSourceType;
	name?: string;
}) {
	const sourceType = args.source_type ?? detectSourceType(args.url);

	// Map plugin source types to API source types
	const apiSourceType = sourceType === "data_source" ? "documentation" : sourceType;

	const body: Record<string, unknown> = {
		type: apiSourceType,
		url: args.url,
	};

	if (sourceType === "repository") {
		body.repository = normalizeRepositoryUrl(args.url);
	}

	if (sourceType === "data_source") {
		body.display_name = args.name?.trim() || new URL(args.url).hostname;
	}

	return {
		sourceType,
		path: "/sources",
		body,
	};
}

function extractSourceId(response: IndexResponse): string | undefined {
	return response.source_id ?? response.id;
}

export function createNiaIndexTool(client: SdkAdapter, config: NiaConfig) {
	return tool({
		description:
			"Index a GitHub repository, docs site, or research paper in Nia.",
		args: {
			url: URL_SCHEMA.describe("GitHub repo, docs, or paper URL to index"),
			source_type: SOURCE_TYPE_SCHEMA.optional().describe(
				"Optional source type override: repository, data_source, or research_paper",
			),
			name: tool.schema
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("Optional display name for the source"),
		},
		async execute(args, context) {
			try {
				const wasAborted = context.abort?.aborted ?? false;
				if (wasAborted) {
					return ABORT_ERROR;
				}

				if (!config.searchEnabled) {
					return "config_error: nia search is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const request = buildRequestBody(args);
				const response = await client.post<IndexResponse>(request.path, request.body);

				const sourceId = extractSourceId(response);

				if (!sourceId) {
					return "invalid_response: missing source_id in Nia API response";
				}

				if (context.sessionID) {
					const sessionState = getSessionState(context.sessionID);
					sessionState.pendingOps.trackOperation({
						id: sourceId,
						type: "index",
						name: args.name ?? args.url,
						sourceType: request.sourceType,
						status: "pending",
					});
				}

				return JSON.stringify(
					{
						source_id: sourceId,
						source_type: request.sourceType,
						status: "queued",
						message:
							"Indexing started. Use nia_manage_resource to check progress.",
					},
					null,
					2,
				);
			} catch (error) {
				return formatError(error, context.abort?.aborted ?? false);
			}
		},
	});
}
