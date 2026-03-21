import { describe, expect, it } from "bun:test";
import {
	classifyApiError,
	createToolErrorFormatter,
	formatUnexpectedError,
	inlineCode,
	isAbortError,
	isZodError,
	stringOrFallback,
	truncateMarkdown,
} from "./format";

describe("formatUnexpectedError", () => {
	it("returns abort error message when wasAborted is true", () => {
		const result = formatUnexpectedError(new Error("test"), true);
		expect(result).toBe("aborted");
	});

	it("returns abort error message for AbortError", () => {
		const error = new DOMException("Aborted", "AbortError");
		const result = formatUnexpectedError(error, false);
		expect(result).toBe("aborted");
	});

	it("returns validation error for ZodError", () => {
		const error = new Error("Validation failed");
		(
			error as Error & { name: string; issues: Array<{ message: string }> }
		).name = "ZodError";
		(error as Error & { issues: unknown }).issues = [
			{ message: "field is required" },
		];
		const result = formatUnexpectedError(error, false);
		expect(result).toBe("validation_error: field is required");
	});

	it("returns unknown_error for regular Error when no toolName provided", () => {
		const error = new Error("Something went wrong");
		const result = formatUnexpectedError(error, false);
		expect(result).toBe("unknown_error: Something went wrong");
	});

	it("returns unknown_error for non-Error values when no toolName provided", () => {
		const result = formatUnexpectedError("some string error", false);
		expect(result).toBe("unknown_error: some string error");
	});

	it("uses custom toolName prefix when provided", () => {
		const error = new Error("Something went wrong");
		const result = formatUnexpectedError(error, false, "search");
		expect(result).toBe("search_error: Something went wrong");
	});

	it("defaults to 'unknown' when toolName not provided", () => {
		const error = new Error("Something went wrong");
		const result = formatUnexpectedError(error, false);
		expect(result).toBe("unknown_error: Something went wrong");
	});
});

describe("createToolErrorFormatter", () => {
	it("returns a function", () => {
		const formatter = createToolErrorFormatter("search");
		expect(typeof formatter).toBe("function");
	});

	it("returns bound formatter that uses toolName prefix", () => {
		const formatter = createToolErrorFormatter("search");
		const error = new Error("Something went wrong");
		const result = formatter(error, false);
		expect(result).toBe("search_error: Something went wrong");
	});

	it("works with different tool names", () => {
		const searchFormatter = createToolErrorFormatter("search");
		const indexFormatter = createToolErrorFormatter("index");
		const searchError = new Error("search failed");
		const indexError = new Error("index failed");
		expect(searchFormatter(searchError, false)).toBe(
			"search_error: search failed",
		);
		expect(indexFormatter(indexError, false)).toBe("index_error: index failed");
	});
});

describe("isAbortError", () => {
	it("returns true for DOMException with AbortError name", () => {
		const error = new DOMException("Aborted", "AbortError");
		expect(isAbortError(error)).toBe(true);
	});

	it("returns false for other DOMException", () => {
		const error = new DOMException("Not found", "NotFoundError");
		expect(isAbortError(error)).toBe(false);
	});

	it("returns false for regular Error", () => {
		expect(isAbortError(new Error("test"))).toBe(false);
	});

	it("returns false for non-Error values", () => {
		expect(isAbortError("string")).toBe(false);
		expect(isAbortError(null)).toBe(false);
		expect(isAbortError(undefined)).toBe(false);
	});
});

describe("isZodError", () => {
	it("returns true for ZodError", () => {
		const error = new Error("Validation failed");
		(error as Error & { name: string; issues: unknown }).name = "ZodError";
		(error as Error & { issues: unknown }).issues = [
			{ message: "field is required" },
		];
		expect(isZodError(error)).toBe(true);
	});

	it("returns false for Error without ZodError name", () => {
		const error = new Error("Regular error");
		expect(isZodError(error)).toBe(false);
	});

	it("returns false for Error without issues array", () => {
		const error = new Error("No issues");
		(error as Error & { name: string }).name = "ZodError";
		expect(isZodError(error)).toBe(false);
	});

	it("returns false for non-Error values", () => {
		expect(isZodError("string")).toBe(false);
		expect(isZodError(null)).toBe(false);
	});
});

describe("inlineCode", () => {
	it("wraps value in backticks", () => {
		expect(inlineCode("hello")).toBe("`hello`");
	});

	it("escapes backticks in value", () => {
		expect(inlineCode("hello`world")).toBe("`hello\\`world`");
	});

	it("handles empty string", () => {
		expect(inlineCode("")).toBe("``");
	});
});

describe("stringOrFallback", () => {
	it("returns first non-empty string", () => {
		expect(stringOrFallback("first", "second")).toBe("first");
	});

	it("skips undefined values", () => {
		expect(stringOrFallback(undefined, "second")).toBe("second");
	});

	it("skips empty strings", () => {
		expect(stringOrFallback("", "second")).toBe("second");
	});

	it("skips whitespace-only strings", () => {
		expect(stringOrFallback("   ", "second")).toBe("second");
	});

	it("returns empty string when all values are falsy", () => {
		expect(stringOrFallback(undefined, "", "   ")).toBe("");
	});
});

describe("classifyApiError", () => {
	it("detects credit/plan exhaustion from forbidden 403 with plan required", () => {
		const result = classifyApiError("forbidden [403]: plan required");
		expect(result).not.toBeNull();
		expect(result?.category).toBe("credits_exhausted");
		expect(result?.actionableMessage).toContain("credits may be exhausted");
	});

	it("detects credit exhaustion with quota pattern", () => {
		const result = classifyApiError("forbidden [403]: quota exceeded for user");
		expect(result).not.toBeNull();
		expect(result?.category).toBe("credits_exhausted");
	});

	it("detects rate limiting from rate_limited 429", () => {
		const result = classifyApiError("rate_limited [429]: slow down");
		expect(result).not.toBeNull();
		expect(result?.category).toBe("rate_limited");
		expect(result?.actionableMessage).toContain("rate limit");
	});

	it("detects auth error from unauthorized 401", () => {
		const result = classifyApiError("unauthorized [401]: bad key");
		expect(result).not.toBeNull();
		expect(result?.category).toBe("auth_error");
		expect(result?.actionableMessage).toContain("invalid or expired");
	});

	it("detects network error", () => {
		const result = classifyApiError("network_error: fetch failed");
		expect(result).not.toBeNull();
		expect(result?.category).toBe("network_error");
		expect(result?.actionableMessage).toContain("network connection");
	});

	it("detects ECONNREFUSED network error", () => {
		const result = classifyApiError("ECONNREFUSED: connection refused");
		expect(result).not.toBeNull();
		expect(result?.category).toBe("network_error");
	});

	it("returns null for unrecognized errors", () => {
		expect(classifyApiError("not_found [404]: resource missing")).toBeNull();
	});

	it("returns null for forbidden without credit patterns", () => {
		expect(classifyApiError("forbidden [403]: access denied")).toBeNull();
	});
});

describe("formatUnexpectedError with actionable messages", () => {
	it("appends actionable message for credit exhaustion errors", () => {
		const error = new Error("forbidden [403]: plan required");
		const result = formatUnexpectedError(error, false, "search");
		expect(result).toContain("search_error: forbidden [403]: plan required");
		expect(result).toContain("credits may be exhausted");
	});

	it("appends actionable message for rate limiting errors", () => {
		const error = new Error("rate_limited [429]: too many requests");
		const result = formatUnexpectedError(error, false, "tracer");
		expect(result).toContain("tracer_error:");
		expect(result).toContain("rate limit");
	});

	it("does not append actionable message for unrecognized errors", () => {
		const error = new Error("Something went wrong");
		const result = formatUnexpectedError(error, false, "search");
		expect(result).toBe("search_error: Something went wrong");
	});

	it("does not append actionable message for abort errors", () => {
		const result = formatUnexpectedError(new Error("test"), true);
		expect(result).toBe("aborted");
	});
});

describe("truncateMarkdown", () => {
	it("returns original string if within maxTokens", () => {
		const input = "short text";
		expect(truncateMarkdown(input, 100)).toBe("short text");
	});

	it("truncates and adds marker when exceeding maxTokens", () => {
		const input = "a".repeat(100);
		const result = truncateMarkdown(input, 20);
		expect(result.length).toBeLessThanOrEqual(20);
		expect(result).toContain("[truncated]");
	});

	it("handles maxTokens of 0", () => {
		const input = "some text";
		const result = truncateMarkdown(input, 0);
		expect(result).toBe("\n\n[truncated]");
	});
});
