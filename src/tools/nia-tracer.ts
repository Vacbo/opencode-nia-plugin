import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { NiaClient } from "../api/client.js";
import type { TracerResultItem } from "../api/types.js";
import type { NiaConfig } from "../config.js";
import { jobManager } from "../state/job-manager.js";
import {
	createToolErrorFormatter,
	inlineCode,
	isAbortError,
	isZodError,
} from "../utils/format.js";

const ABORT_ERROR = "abort_error [nia_tracer]: request aborted";
const formatError = createToolErrorFormatter("tracer");
const DEFAULT_TIMEOUT_SECONDS = 120;
const TERMINAL_STATUSES = new Set([
	"completed",
	"failed",
	"error",
	"cancelled",
]);

export type TracerMode = "tracer-fast" | "tracer-deep";

type TracerQueryValue =
	| string
	| number
	| boolean
	| Array<string | number | boolean>
	| null
	| undefined;
type TracerQueryParams = Record<string, TracerQueryValue>;

type TracerJobResponse = {
	id?: string;
	job_id?: string;
	session_id?: string;
	status?: string;
	query?: string;
	created_at?: string;
	completed_at?: string;
	result?: string;
	results?: TracerResultItem[];
	error?: string;
};

type FormatTracerResponseOptions = {
	mode?: TracerMode;
	query?: string;
};

export interface NiaTracerArgs {
	query?: string;
	repositories?: string[];
	tracer_mode: TracerMode;
	job_id?: string;
}

const niaTracerArgsShape = {
	query: z.string().trim().min(1).optional(),
	repositories: z.array(z.string().trim().min(1)).optional(),
	tracer_mode: z.enum(["tracer-fast", "tracer-deep"]).default("tracer-fast"),
	job_id: z.string().trim().min(1).optional(),
};

export const niaTracerArgsSchema = z
	.object(niaTracerArgsShape)
	.superRefine((args, context) => {
		if (!args.job_id && !args.query) {
			context.addIssue({
				code: "custom",
				path: ["query"],
				message: "query is required when job_id is not provided",
			});
		}
	});

export function createNiaTracerTool(client: NiaClient, config: NiaConfig) {
	return tool({
		description:
			"Search public GitHub repositories with Nia Tracer in fast or deep mode.",
		args: niaTracerArgsShape,
		async execute(rawArgs, context) {
			try {
				const args = niaTracerArgsSchema.parse(rawArgs);
				if (context.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.tracerEnabled) {
					return "config_error: nia tracer is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const timeoutMs = Math.max(
					1,
					(config.tracerTimeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
				);

				if (args.job_id) {
					const response = (await client.get(
						`/github/tracer/${encodeURIComponent(args.job_id)}`,
						undefined,
						context.abort,
						timeoutMs,
					)) as string | TracerJobResponse;

					if (typeof response === "string") {
						return response;
					}

					return formatTracerResponse(response, { query: args.query });
				}

				if (args.tracer_mode === "tracer-deep") {
					const response = (await client.post(
						"/github/tracer/jobs",
						buildCreateBody(args),
						context.abort,
						timeoutMs,
					)) as string | TracerJobResponse;

					if (typeof response === "string") {
						return response;
					}

					const jobId = getJobId(response);
					if (!jobId) {
						return "invalid_response: missing job_id in Nia tracer response";
					}

					jobManager.submitJob(
						"tracer",
						jobId,
						context.sessionID,
						context.agent,
					);
					jobManager.consumeSSE(jobId, client);

					return `Deep tracer analysis started. Results will be delivered when complete. Job ID: ${jobId}`;
				}

				const response = (await client.post(
					"/github/tracer",
					buildCreateBody(args),
					context.abort,
					timeoutMs,
				)) as string | TracerJobResponse;

				if (typeof response === "string") {
					return response;
				}

				if (hasInlineResult(response) || isTerminalStatus(response.status)) {
					return formatTracerResponse(response, {
						mode: args.tracer_mode,
						query: args.query,
					});
				}

				const jobId = getJobId(response);
				if (!jobId) {
					return "invalid_response: missing job_id in Nia tracer response";
				}

				return formatQueuedResponse(response, args.tracer_mode, args.query);
			} catch (error) {
				if (context.abort.aborted || isAbortError(error)) {
					return ABORT_ERROR;
				}
				return formatError(error, false);
			}
		},
	});
}

function buildCreateBody(args: NiaTracerArgs): Record<string, unknown> {
	return {
		query: args.query,
		repositories: args.repositories,
		mode: args.tracer_mode,
	};
}

function formatQueuedResponse(
	response: TracerJobResponse,
	mode: TracerMode,
	query?: string,
): string {
	const message = formatTracerResponse(response, { mode, query });
	const jobId = getJobId(response);

	if (!jobId || isTerminalStatus(response.status)) {
		return message;
	}

	return `${message}\n\nRe-run this tool with \`job_id\` set to ${inlineCode(jobId)} to check status.`;
}

function formatTracerResponse(
	response: TracerJobResponse,
	options: FormatTracerResponseOptions = {},
): string {
	const headerLines = ["# Nia Tracer"];
	const jobId = getJobId(response);

	if (options.mode) {
		headerLines.push(`- Mode: ${inlineCode(options.mode)}`);
	}

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

	if (response.session_id) {
		headerLines.push(`- Session ID: ${inlineCode(response.session_id)}`);
	}

	if (response.created_at) {
		headerLines.push(`- Created: ${response.created_at}`);
	}

	if (response.completed_at) {
		headerLines.push(`- Completed: ${response.completed_at}`);
	}

	const sections = [headerLines.join("\n")];
	if (response.result?.trim()) {
		sections.push(`## Result\n${response.result}`);
	}

	if (Array.isArray(response.results) && response.results.length > 0) {
		sections.push(`## Matches\n${formatMatches(response.results)}`);
	}

	if (response.error?.trim()) {
		sections.push(`## Error\n${response.error}`);
	}

	if (
		!response.result?.trim() &&
		(!response.results || response.results.length === 0)
	) {
		if (response.status && !isTerminalStatus(response.status)) {
			sections.push(`Tracer job is still ${inlineCode(response.status)}.`);
		} else if (response.status === "completed") {
			sections.push("No tracer results returned.");
		}
	}

	return sections.join("\n\n");
}

function formatMatches(results: TracerResultItem[]): string {
	return results
		.map((result, index) => {
			const location =
				result.line_number !== undefined
					? `${result.path}:${result.line_number}`
					: result.path;
			const lines = [`${index + 1}. ${inlineCode(location)}`];

			if (result.repository) {
				lines.push(`   - Repository: ${inlineCode(result.repository)}`);
			}

			if (typeof result.score === "number") {
				lines.push(`   - Score: ${result.score.toFixed(2)}`);
			}

			lines.push(`   - Snippet: ${result.content}`);
			return lines.join("\n");
		})
		.join("\n\n");
}

function getJobId(response: TracerJobResponse): string | undefined {
	return response.job_id ?? response.id;
}

function hasInlineResult(response: TracerJobResponse): boolean {
	return (
		Boolean(response.result?.trim()) ||
		(Array.isArray(response.results) && response.results.length > 0)
	);
}

function isTerminalStatus(status: string | undefined): boolean {
	return status ? TERMINAL_STATUSES.has(status) : false;
}
