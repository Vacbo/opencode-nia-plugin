import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";
import { jobManager } from "../state/job-manager.js";
import {
	createToolErrorFormatter,
	inlineCode,
	isAbortError,
} from "../utils/format.js";

type DocumentAgentAction =
	| "sync"
	| "async_submit"
	| "async_status"
	| "async_stream"
	| "async_delete";

type DocumentCitation = {
	content: string;
	page_number?: number | null;
	section_id?: string | null;
	section_title?: string | null;
	section_path?: string[] | null;
	tool_source: string;
	source_id?: string | null;
	source_name?: string | null;
};

type DocumentAgentResponse = {
	id?: string;
	job_id?: string;
	status?: string;
	message?: string;
	query?: string;
	answer?: string;
	citations?: DocumentCitation[];
	structured_output?: Record<string, unknown> | null;
	model?: string;
	usage?: Record<string, number> | null;
	error?: string;
	created_at?: string;
	completed_at?: string;
	source_id?: string | null;
	source_ids?: string[] | null;
};

type FormatDocumentResponseOptions = {
	action: DocumentAgentAction;
	jobId?: string;
	query?: string;
	sourceId?: string;
	sourceIds?: string[];
};

type DocumentAgentArgs = {
	action: DocumentAgentAction;
	source_id?: string;
	source_ids?: string[];
	query?: string;
	job_id?: string;
	json_schema?: string;
	model?: string;
	thinking_enabled?: boolean;
	thinking_budget?: number;
};

const ABORT_ERROR = "abort_error [nia_document_agent]: request aborted";
const TERMINAL_STATUSES = new Set([
	"completed",
	"failed",
	"error",
	"cancelled",
]);
const formatError = createToolErrorFormatter("document_agent");

const niaDocumentAgentArgsShape = {
	action: z.enum([
		"sync",
		"async_submit",
		"async_status",
		"async_stream",
		"async_delete",
	]),
	source_id: z.string().trim().min(1).optional(),
	source_ids: z.array(z.string().trim().min(1)).min(1).max(10).optional(),
	query: z.string().trim().min(1).max(10_000).optional(),
	job_id: z.string().trim().min(1).optional(),
	json_schema: z.string().trim().min(1).optional(),
	model: z.string().trim().min(1).optional(),
	thinking_enabled: z.boolean().optional(),
	thinking_budget: z.number().int().min(1000).max(50_000).optional(),
};

const niaDocumentAgentArgsSchema = z
	.object(niaDocumentAgentArgsShape)
	.superRefine((args, context) => {
		if (requiresDocumentSelection(args.action)) {
			if (!args.query) {
				context.addIssue({
					code: "custom",
					path: ["query"],
					message: "query is required for sync and async_submit actions",
				});
			}

			if (!args.source_id && !args.source_ids?.length) {
				context.addIssue({
					code: "custom",
					path: ["source_id"],
					message: "source_id or source_ids is required for sync and async_submit actions",
				});
			}

			if (args.source_id && args.source_ids?.length) {
				context.addIssue({
					code: "custom",
					path: ["source_ids"],
					message: "provide either source_id or source_ids, not both",
				});
			}
		}

		if (requiresJobId(args.action) && !args.job_id) {
			context.addIssue({
				code: "custom",
				path: ["job_id"],
				message: `job_id is required for ${args.action} action`,
			});
		}

		if (args.json_schema && !isJsonObject(args.json_schema)) {
			context.addIssue({
				code: "custom",
				path: ["json_schema"],
				message: "json_schema must be a valid JSON object string",
			});
		}
	});

export function createNiaDocumentAgentTool(
	client: SdkAdapter,
	config: NiaConfig,
) {
	return tool({
		description:
			"Analyze indexed PDF documents with an AI agent and return cited answers, structured output, or async job status.",
		args: niaDocumentAgentArgsShape,
		async execute(rawArgs, context) {
			try {
				const args = niaDocumentAgentArgsSchema.parse(rawArgs);
				if (context.abort.aborted) {
					return ABORT_ERROR;
				}

				if (config.documentAgentEnabled === false) {
					return "config_error: nia document agent is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				switch (args.action) {
					case "sync": {
						const response =
							(await client.documentAgent.query(
								buildDocumentQueryBody(args),
							)) as DocumentAgentResponse;

						return formatDocumentResponse(response, {
							action: args.action,
							query: args.query,
							sourceId: args.source_id,
							sourceIds: args.source_ids,
						});
					}

					case "async_submit": {
						const response =
							(await client.documentAgent.createJob(
								buildDocumentQueryBody(args),
							)) as DocumentAgentResponse;

						const jobId = getJobId(response);
						if (!jobId) {
							return "invalid_response: missing job_id in Nia document agent response";
						}

						jobManager.submitJob(
							"document_agent",
							jobId,
							context.sessionID,
							context.agent,
						);
						void jobManager.consumeSSE(jobId, client);

						return formatSubmitResponse(response, {
							action: args.action,
							jobId,
							query: args.query,
							sourceId: args.source_id,
							sourceIds: args.source_ids,
						});
					}

					case "async_status": {
						const jobId = args.job_id!;
						const response =
							(await client.documentAgent.getJob(
								jobId,
							)) as DocumentAgentResponse;
						return formatDocumentResponse(response, {
							action: args.action,
							jobId,
						});
					}

					case "async_stream": {
						const jobId = args.job_id!;
						jobManager.submitJob(
							"document_agent",
							jobId,
							context.sessionID,
							context.agent,
						);
						void jobManager.consumeSSE(jobId, client);
						return [
							"# Nia Document Agent",
							`- Action: ${inlineCode(args.action)}`,
							`- Job ID: ${inlineCode(jobId)}`,
							"",
							`Streaming document agent job ${inlineCode(jobId)}. Results will be delivered when complete.`,
						].join("\n");
					}

					case "async_delete": {
						const jobId = args.job_id!;
						const response =
							(await jobManager.cancelJob(
								jobId,
								client,
								"document_agent",
							)) as DocumentAgentResponse | undefined;

						return formatDeleteResponse(jobId, response);
					}
				}
			} catch (error) {
				if (context.abort.aborted || isAbortError(error)) {
					return ABORT_ERROR;
				}

				return formatError(error, false);
			}
		},
	});
}

function requiresDocumentSelection(action: DocumentAgentAction): boolean {
	return action === "sync" || action === "async_submit";
}

function requiresJobId(action: DocumentAgentAction): boolean {
	return (
		action === "async_status" ||
		action === "async_stream" ||
		action === "async_delete"
	);
}

function isJsonObject(value: string): boolean {
	try {
		const parsed = JSON.parse(value);
		return isRecord(parsed);
	} catch {
		return false;
	}
}

function parseJsonSchema(
	rawJsonSchema: string | undefined,
): Record<string, unknown> | undefined {
	if (!rawJsonSchema) {
		return undefined;
	}

	const parsed = JSON.parse(rawJsonSchema);
	if (!isRecord(parsed)) {
		throw new Error("json_schema must be a JSON object");
	}

	return parsed;
}

function buildDocumentQueryBody(
	args: DocumentAgentArgs,
): Record<string, unknown> {
	return {
		...(args.source_id ? { source_id: args.source_id } : {}),
		...(args.source_ids?.length ? { source_ids: args.source_ids } : {}),
		query: args.query,
		...(args.json_schema
			? { json_schema: parseJsonSchema(args.json_schema) }
			: {}),
		...(args.model ? { model: args.model } : {}),
		...(args.thinking_enabled !== undefined
			? { thinking_enabled: args.thinking_enabled }
			: {}),
		...(args.thinking_budget !== undefined
			? { thinking_budget: args.thinking_budget }
			: {}),
	};
}

function formatSubmitResponse(
	response: DocumentAgentResponse,
	options: FormatDocumentResponseOptions,
): string {
	const message = formatDocumentResponse(response, options);
	const jobId = getJobId(response) ?? options.jobId;

	if (!jobId || isTerminalStatus(response.status)) {
		return message;
	}

	return `${message}\n\nResults will be delivered when complete. Re-run this tool with ${inlineCode("action")} set to ${inlineCode("async_status")} and ${inlineCode("job_id")} set to ${inlineCode(jobId)} to check status manually.`;
}

function formatDeleteResponse(
	jobId: string,
	response?: DocumentAgentResponse,
): string {
	const sections = [
		"# Nia Document Agent",
		`- Action: ${inlineCode("async_delete")}`,
		`- Job ID: ${inlineCode(jobId)}`,
	];

	if (response?.status) {
		sections.push(`- Status: ${inlineCode(response.status)}`);
	}

	if (response?.message?.trim()) {
		sections.push("", response.message);
	} else {
		sections.push("", `Document agent job ${inlineCode(jobId)} cancelled.`);
	}

	return sections.join("\n");
}

function formatDocumentResponse(
	response: DocumentAgentResponse,
	options: FormatDocumentResponseOptions,
): string {
	const headerLines = [
		"# Nia Document Agent",
		`- Action: ${inlineCode(options.action)}`,
	];

	const jobId = getJobId(response) ?? options.jobId;
	if (jobId) {
		headerLines.push(`- Job ID: ${inlineCode(jobId)}`);
	}

	if (response.status) {
		headerLines.push(`- Status: ${inlineCode(response.status)}`);
	}

	const query = response.query ?? options.query;
	if (query) {
		headerLines.push(`- Query: ${inlineCode(query)}`);
	}

	const sourceId = response.source_id ?? options.sourceId;
	if (sourceId) {
		headerLines.push(`- Source ID: ${inlineCode(sourceId)}`);
	}

	const sourceIds = response.source_ids ?? options.sourceIds;
	if (sourceIds?.length) {
		headerLines.push(
			`- Source IDs: ${sourceIds.map((value) => inlineCode(value)).join(", ")}`,
		);
	}

	if (response.model) {
		headerLines.push(`- Model: ${inlineCode(response.model)}`);
	}

	if (response.created_at) {
		headerLines.push(`- Created: ${response.created_at}`);
	}

	if (response.completed_at) {
		headerLines.push(`- Completed: ${response.completed_at}`);
	}

	const sections = [headerLines.join("\n")];

	if (response.message?.trim() && !response.answer?.trim()) {
		sections.push(`## Message\n${response.message}`);
	}

	if (response.answer?.trim()) {
		sections.push(`## Answer\n${response.answer}`);
	}

	if (response.structured_output && isRecord(response.structured_output)) {
		sections.push(
			`## Structured Output\n\`\`\`json\n${JSON.stringify(response.structured_output, null, 2)}\n\`\`\``
		);
	}

	if (response.citations?.length) {
		sections.push(`## Citations\n${formatCitations(response.citations)}`);
	}

	if (response.usage && isRecord(response.usage)) {
		sections.push(`## Usage\n${formatUsage(response.usage)}`);
	}

	if (response.error?.trim()) {
		sections.push(`## Error\n${response.error}`);
	}

	if (!response.answer?.trim() && !response.error?.trim()) {
		if (response.status && !isTerminalStatus(response.status)) {
			sections.push(`Document agent job is still ${inlineCode(response.status)}.`);
		} else if (isTerminalStatus(response.status)) {
			sections.push("No document agent result returned.");
		}
	}

	return sections.join("\n\n");
}

function formatCitations(citations: DocumentCitation[]): string {
	return citations
		.map((citation, index) => {
			const label =
				citation.source_name ??
				citation.section_title ??
				citation.source_id ??
				`Citation ${index + 1}`;
			const lines = [`${index + 1}. ${label}`];

			if (citation.source_id) {
				lines.push(`   - Source ID: ${inlineCode(citation.source_id)}`);
			}

			if (citation.tool_source) {
				lines.push(`   - Tool: ${inlineCode(citation.tool_source)}`);
			}

			if (typeof citation.page_number === "number") {
				lines.push(`   - Page: ${inlineCode(String(citation.page_number))}`);
			}

			if (citation.section_title) {
				lines.push(`   - Section: ${inlineCode(citation.section_title)}`);
			}

			if (citation.section_id) {
				lines.push(`   - Section ID: ${inlineCode(citation.section_id)}`);
			}

			if (citation.section_path?.length) {
				lines.push(
					`   - Section Path: ${citation.section_path
						.map((value) => inlineCode(value))
						.join(" > ")}`,
				);
			}

			lines.push(`   - Quote: ${citation.content}`);
			return lines.join("\n");
		})
		.join("\n\n");
}

function formatUsage(usage: Record<string, unknown>): string {
	return Object.entries(usage)
		.map(([key, value]) => `- ${key}: ${String(value)}`)
		.join("\n");
}

function getJobId(response: DocumentAgentResponse): string | undefined {
	return response.job_id ?? response.id;
}

function isTerminalStatus(status: string | undefined): boolean {
	return status ? TERMINAL_STATUSES.has(status) : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
