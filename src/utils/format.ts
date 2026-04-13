import type { ClassifiedApiError } from "../api/types.js";

const ABORT_ERROR = "aborted";
const TRUNCATED_MARKER = "\n\n[truncated]";
const DEFAULT_TOOL_NAME = "unknown";

export function classifyApiError(
	errorString: string,
): ClassifiedApiError | null {
	if (errorString.includes("forbidden") && errorString.includes("403")) {
		if (/plan required|credits?|quota|limit exceeded/i.test(errorString)) {
			return {
				category: "credits_exhausted",
				actionableMessage:
					"⚠️ Your Nia credits may be exhausted or your plan doesn't include this feature. Check your usage at https://app.trynia.ai",
			};
		}
	}

	if (
		errorString.includes("rate_limited") ||
		errorString.includes("429")
	) {
		return {
			category: "rate_limited",
			actionableMessage:
				"Nia API rate limit hit. The request will be retried automatically.",
		};
	}

	if (
		errorString.includes("unauthorized") ||
		errorString.includes("401")
	) {
		return {
			category: "auth_error",
			actionableMessage:
				"Nia API key is invalid or expired. Update your key at ~/.config/nia/api_key",
		};
	}

	if (
		errorString.includes("network_error") ||
		errorString.includes("ECONNREFUSED") ||
		errorString.includes("timeout_error") ||
		errorString.includes("ECONNRESET") ||
		errorString.includes("ETIMEDOUT")
	) {
		return {
			category: "network_error",
			actionableMessage:
				"Unable to reach Nia API. Check your network connection.",
		};
	}

	return null;
}

export function formatUnexpectedError(
	error: unknown,
	wasAborted: boolean,
	toolName?: string,
): string {
	const tool = toolName ?? DEFAULT_TOOL_NAME;

	if (wasAborted || isAbortError(error)) {
		return ABORT_ERROR;
	}

	if (isZodError(error)) {
		return `validation_error: ${error.issues.map((issue) => issue.message).join("; ")}`;
	}

	const baseMessage =
		error instanceof Error
			? `${tool}_error: ${error.message}`
			: `${tool}_error: ${String(error)}`;

	const classified = classifyApiError(baseMessage);
	if (classified) {
		return `${baseMessage}\n\n${classified.actionableMessage}`;
	}

	return baseMessage;
}

export function createToolErrorFormatter(
	toolName: string,
): (error: unknown, wasAborted: boolean) => string {
	return (error: unknown, wasAborted: boolean) =>
		formatUnexpectedError(error, wasAborted, toolName);
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException ? error.name === "AbortError" : false;
}

export function isZodError(
	error: unknown,
): error is Error & { issues: Array<{ message: string }> } {
	return (
		error instanceof Error &&
		error.name === "ZodError" &&
		"issues" in error &&
		Array.isArray((error as { issues?: unknown }).issues)
	);
}

export function inlineCode(value: string): string {
	return `\`${value.replaceAll("`", "\\`")}\``;
}

export type NormalizedResult = {
	title: string;
	excerpt: string;
	url?: string;
	filePath?: string;
	score?: number;
	sourceType?: string;
	highlights?: string[];
};

export function formatResults(results: NormalizedResult[]): string {
	return results
		.map((result, index) => {
			const lines = [`${index + 1}. **${result.title}**`];

			if (result.url) {
				lines.push(`   - URL: ${result.url}`);
			}

			if (result.filePath) {
				lines.push(`   - Path: ${inlineCode(result.filePath)}`);
			}

			if (result.sourceType) {
				lines.push(`   - Source: ${inlineCode(result.sourceType)}`);
			}

			if (typeof result.score === "number") {
				lines.push(`   - Score: ${result.score.toFixed(2)}`);
			}

			if (result.highlights && result.highlights.length > 0) {
				lines.push(`   - Highlights: ${result.highlights.join(", ")}`);
			}

			lines.push(`   - Excerpt: ${result.excerpt}`);
			return lines.join("\n");
		})
		.join("\n\n");
}

export function stringOrFallback(...values: Array<string | undefined>): string {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}

	return "";
}

export function truncateMarkdown(markdown: string, maxTokens: number): string {
	if (markdown.length <= maxTokens) {
		return markdown;
	}

	const sliceLength = Math.max(0, maxTokens - TRUNCATED_MARKER.length);
	return `${markdown.slice(0, sliceLength).trimEnd()}${TRUNCATED_MARKER}`;
}
