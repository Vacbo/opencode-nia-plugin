const ABORT_ERROR = "aborted";
const TRUNCATED_MARKER = "\n\n[truncated]";
const DEFAULT_TOOL_NAME = "unknown";

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

	if (error instanceof Error) {
		return `${tool}_error: ${error.message}`;
	}

	return `${tool}_error: ${String(error)}`;
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
