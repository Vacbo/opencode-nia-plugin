import { describe, expect, it } from "bun:test";
import { stripJsoncComments } from "./config.js";

describe("stripJsoncComments", () => {
	it("should not strip URLs containing //", () => {
		const input = '{"url": "https://example.com/api"}';
		const result = stripJsoncComments(input);
		expect(result).toBe('{"url": "https://example.com/api"}');
	});

	it("should not strip URLs with multiple slashes", () => {
		const input = '{"url": "https://api.github.com/repos/owner/name"}';
		const result = stripJsoncComments(input);
		expect(result).toBe('{"url": "https://api.github.com/repos/owner/name"}');
	});

	it("should remove line comments", () => {
		const input = `{
  // This is a comment
  "key": "value"
}`;
		const result = stripJsoncComments(input);
		expect(result).not.toContain("// This is a comment");
		expect(result).toContain('"key": "value"');
	});

	it("should remove line comments at end of line", () => {
		const input = '{"key": "value"} // trailing comment';
		const result = stripJsoncComments(input);
		expect(result).toBe('{"key": "value"} ');
		expect(result).not.toContain("trailing comment");
	});

	it("should remove block comments", () => {
		const input = `{
  /* This is a
     block comment */
  "key": "value"
}`;
		const result = stripJsoncComments(input);
		expect(result).not.toContain("This is a");
		expect(result).not.toContain("block comment");
		expect(result).toContain('"key": "value"');
	});

	it("should handle mixed comments and URLs", () => {
		const input = `{
  "url": "https://example.com",
  // API key
  "apiKey": "test"
}`;
		const result = stripJsoncComments(input);
		expect(result).toContain('"url": "https://example.com"');
		expect(result).not.toContain("// API key");
		expect(result).toContain('"apiKey": "test"');
	});

	it("should handle JSONC with comments only", () => {
		const input = `// This is a comment
{"key": "value"}`;
		const result = stripJsoncComments(input);
		expect(result).toBe('{"key": "value"}');
	});
});
