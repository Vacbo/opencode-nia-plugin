import { tool } from "@opencode-ai/plugin";

import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";

import { createToolErrorFormatter, inlineCode } from "../utils/format.js";

type UsageResponse = {
	credits_used?: number;
	credits_remaining?: number;
	reset_date?: string;
	plan?: string;
	user_id?: string;
	organization_id?: string | null;
	subscription_tier?: string;
	billing_period_start?: string;
	billing_period_end?: string;
	usage?: Record<
		string,
		{
			used?: number;
			limit?: number;
			unlimited?: boolean;
		}
	>;
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
	if (hasLiveUsageShape(response)) {
		return formatLiveUsageResponse(response);
	}

	const sections = [
		"# Nia Usage",
		`## Quota Information`,
		`- Plan: ${inlineCode(response.plan ?? "unknown")}`,
		`- Credits Used: ${response.credits_used ?? 0}`,
		`- Credits Remaining: ${response.credits_remaining ?? 0}`,
		`- Reset Date: ${formatDate(response.reset_date)}`,
	];

	return sections.join("\n\n");
}

function hasLiveUsageShape(response: UsageResponse): boolean {
	return Boolean(response.subscription_tier || response.billing_period_start || response.billing_period_end || response.usage);
}

function formatLiveUsageResponse(response: UsageResponse): string {
	const sections = [
		"# Nia Usage",
		"## Subscription",
		`- Tier: ${inlineCode(response.subscription_tier ?? "unknown")}`,
		`- Billing Period Start: ${formatDate(response.billing_period_start)}`,
		`- Billing Period End: ${formatDate(response.billing_period_end)}`,
	];

	const usageEntries = Object.entries(response.usage ?? {});
	if (usageEntries.length > 0) {
		const lines = usageEntries.map(([bucket, stats]) => {
			const used = stats.used ?? 0;
			const limit = stats.unlimited ? "unlimited" : String(stats.limit ?? 0);
			return `- ${inlineCode(bucket)}: ${used} / ${limit}`;
		});
		sections.push(`## Usage\n${lines.join("\n")}`);
	}

	return sections.join("\n\n");
}

function formatDate(dateString?: string): string {
	if (typeof dateString !== "string" || dateString.trim() === "") {
		return "unknown";
	}

	const date = new Date(dateString);
	if (Number.isNaN(date.getTime())) {
		return dateString;
	}

	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}
