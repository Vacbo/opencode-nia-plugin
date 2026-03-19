import { tool } from "@opencode-ai/plugin";
import type { NiaClient } from "../api/client.js";
import type { FileContentResponse } from "../api/types.js";
import { resolveSource } from "./source-resolver.js";

const MAX_CONTENT_BYTES = 50 * 1024;

export function createNiaReadTool(client: NiaClient) {
  return tool({
    description:
      "Read file content from a Nia-indexed repository or data source. " +
      "Supports optional line ranges. Content truncated at 50KB.",
    args: {
      source_id: tool.schema
        .string()
        .optional()
        .describe("Direct source ID. Use this OR source_type + identifier."),
      source_type: tool.schema
        .enum(["repository", "data_source"])
        .optional()
        .describe("Source type (repository or data_source)"),
      identifier: tool.schema
        .string()
        .optional()
        .describe("Source identifier (e.g. 'owner/repo' or docs URL)"),
      path: tool.schema.string().describe("File path to read"),
      line_start: tool.schema.number().optional().describe("Start line (1-based)"),
      line_end: tool.schema.number().optional().describe("End line (1-based, inclusive)"),
    },
    async execute(args, ctx) {
      const resolved = await resolveSource(client, args, ctx.abort);
      if (typeof resolved === "string") return resolved;

      const params: Record<string, string | number> = { path: args.path };
      if (args.line_start !== undefined) params.start_line = args.line_start;
      if (args.line_end !== undefined) params.end_line = args.line_end;

      const result = await client.get<FileContentResponse>(
        `/${resolved.endpoint}/${resolved.id}/content`,
        params,
        ctx.abort,
      );

      if (typeof result === "string") return result;

      let content = result.content;
      let truncated = false;
      const byteLength = new TextEncoder().encode(content).byteLength;

      if (byteLength > MAX_CONTENT_BYTES) {
        const bytes = new TextEncoder().encode(content);
        content = new TextDecoder().decode(bytes.slice(0, MAX_CONTENT_BYTES));
        truncated = true;
      }

      const meta = [
        `**Size:** ${result.size} bytes`,
        `**Lines:** ${result.line_count}`,
        args.line_start || args.line_end
          ? `**Range:** ${args.line_start ?? 1}\u2013${args.line_end ?? result.line_count}`
          : null,
        truncated ? `**\u26a0\ufe0f Truncated:** Content exceeds 50KB limit` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      return `## ${result.path}\n${meta}\n\n\`\`\`\n${content}\n\`\`\``;
    },
  });
}
