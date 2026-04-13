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

type SandboxResultItem = {
	repository?: string;
	ref?: string;
	path: string;
	content: string;
	line_number?: number;
	score: number;
};

type SandboxJobResponse = {
	id?: string;
	job_id?: string;
	session_id?: string;
	status?: string;
	repository?: string;
	ref?: string;
	query?: string;
	created_at?: string;
	completed_at?: string;
	result?: string;
	results?: SandboxResultItem[];
	error?: string;
};

type FormatSandboxResponseOptions = {
	repository?: string;
	ref?: string;
	query?: string;
};

const ABORT_ERROR = "abort_error [nia_sandbox]: request aborted";
const TERMINAL_STATUSES = new Set([
	"completed",
	"failed",
	"error",
	"cancelled",
]);
const formatError = createToolErrorFormatter("sandbox");

export interface NiaSandboxArgs {
	repository?: string;
	ref: string;
	query?: string;
	job_id?: string;
}

const niaSandboxArgsShape = {
	repository: z.string().trim().min(1).optional(),
	ref: z.string().trim().min(1).default("main"),
	query: z.string().trim().min(1).optional(),
	job_id: z.string().trim().min(1).optional(),
};

export const niaSandboxArgsSchema = z
	.object(niaSandboxArgsShape)
	.superRefine((args, context) => {
		if (args.job_id) {
			return;
		}

		if (!args.repository) {
			context.addIssue({
				code: "custom",
				path: ["repository"],
				message: "repository is required when job_id is not provided",
			});
		}

		if (!args.query) {
			context.addIssue({
				code: "custom",
				path: ["query"],
				message: "query is required when job_id is not provided",
			});
		}
	});

export function createNiaSandboxTool(client: SdkAdapter, config: NiaConfig) {
	return tool({
		description:
			"Run an ephemeral sandbox search against a public repository without indexing it first.",
		args: niaSandboxArgsShape,
		async execute(rawArgs, context) {
			try {
				const args = niaSandboxArgsSchema.parse(rawArgs);
				if (context.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.sandboxEnabled) {
					return "config_error: nia sandbox is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				if (args.job_id) {
					const response =
						(await client.sandbox.getJob(args.job_id)) as SandboxJobResponse;
					return formatSandboxResponse(response, {
						repository: args.repository,
						ref: args.ref,
						query: args.query,
					});
				}

				const response =
					(await client.sandbox.createJob(buildCreateBody(args))) as SandboxJobResponse;

				if (hasInlineResult(response) || isTerminalStatus(response.status)) {
					return formatSandboxResponse(response, {
						repository: args.repository,
						ref: args.ref,
						query: args.query,
					});
				}

				const jobId = getJobId(response);
				if (!jobId) {
					return "invalid_response: missing job_id in Nia sandbox response";
				}

				jobManager.submitJob("sandbox", jobId, context.sessionID, context.agent);
				void jobManager.consumeSSE(jobId, client);

				return formatQueuedResponse(response, {
					repository: args.repository,
					ref: args.ref,
					query: args.query,
				});
			} catch (error) {
				if (context.abort.aborted || isAbortError(error)) {
					return ABORT_ERROR;
				}
				return formatError(error, false);
			}
		},
	});
}

function buildCreateBody(args: NiaSandboxArgs): Record<string, unknown> {
	return {
		repository: args.repository,
		ref: args.ref,
		query: args.query,
	};
}

function formatQueuedResponse(
	response: SandboxJobResponse,
	options: FormatSandboxResponseOptions,
): string {
	const message = formatSandboxResponse(response, options);
	const jobId = getJobId(response);

	if (!jobId || isTerminalStatus(response.status)) {
		return message;
	}

	return `${message}\n\nRe-run this tool with \`job_id\` set to ${inlineCode(jobId)} to check status.`;
}

function formatSandboxResponse(
	response: SandboxJobResponse,
	options: FormatSandboxResponseOptions = {},
): string {
	const headerLines = ["# Nia Sandbox"];
	const jobId = getJobId(response);

	if (jobId) {
		headerLines.push(`- Job ID: ${inlineCode(jobId)}`);
	}

	if (response.status) {
		headerLines.push(`- Status: ${inlineCode(response.status)}`);
	}

	const repository = response.repository ?? options.repository;
	if (repository) {
		headerLines.push(`- Repository: ${inlineCode(repository)}`);
	}

	const ref = response.ref ?? options.ref;
	if (ref) {
		headerLines.push(`- Ref: ${inlineCode(ref)}`);
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

	if (!response.result?.trim() && (!response.results || response.results.length === 0)) {
		if (response.status && !isTerminalStatus(response.status)) {
			sections.push(`Sandbox job is still ${inlineCode(response.status)}.`);
		} else if (response.status === "completed") {
			sections.push("No sandbox results returned.");
		}
	}

	return sections.join("\n\n");
}

function formatMatches(results: SandboxResultItem[]): string {
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

			if (result.ref) {
				lines.push(`   - Ref: ${inlineCode(result.ref)}`);
			}

			if (typeof result.score === "number") {
				lines.push(`   - Score: ${result.score.toFixed(2)}`);
			}

			lines.push(`   - Snippet: ${result.content}`);
			return lines.join("\n");
		})
		.join("\n\n");
}

function getJobId(response: SandboxJobResponse): string | undefined {
	return response.job_id ?? response.id;
}

function hasInlineResult(response: SandboxJobResponse): boolean {
	return (
		Boolean(response.result?.trim()) ||
		(Array.isArray(response.results) && response.results.length > 0)
	);
}

function isTerminalStatus(status: string | undefined): boolean {
	return status ? TERMINAL_STATUSES.has(status) : false;
}
