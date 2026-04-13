import { tool } from "@opencode-ai/plugin";

import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";

import { createToolErrorFormatter, inlineCode } from "../utils/format.js";

type UsageResponse = {
	credits_used: number;
	credits_remaining: number;
	reset_date: string;
	plan: string;
};

const formatUnexpectedError = createToolErrorFormatter("usage");

const ABORT_ERROR = "abort_error [nia_usage]: request aborted";

export function createNiaUsageTool(client: SdkAdapter, config: NiaConfig) {
	return tool({
		description: "Retrieve current Nia API quota and usage information",
		args: {},
		async execute(_rawArgs, context) {
			try {
				if (context.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.usageEnabled) {
					return "config_error: nia usage is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const response = await client.get<UsageResponse>("/usage");

				return formatResponse(response);
			} catch (error) {
				return formatUnexpectedError(error, context.abort.aborted);
			}
		},
	});
}

function formatResponse(response: UsageResponse): string {
	const sections = [
		"# Nia Usage",
		`## Quota Information`,
		`- Plan: ${inlineCode(response.plan)}`,
		`- Credits Used: ${response.credits_used}`,
		`- Credits Remaining: ${response.credits_remaining}`,
		`- Reset Date: ${formatDate(response.reset_date)}`,
	];

	return sections.join("\n\n");
}

function formatDate(dateString: string): string {
	try {
		const date = new Date(dateString);
		return date.toLocaleDateString("en-US", {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
	} catch {
		return dateString;
	}
}
