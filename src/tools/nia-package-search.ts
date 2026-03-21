import { tool } from "@opencode-ai/plugin";

import type { NiaClient } from "../api/client.js";
import type { PackageSearchResponse, PackageSearchResultItem } from "../api/types.js";
import type { NiaConfig } from "../config.js";

type Registry = "npm" | "pypi" | "crates" | "go";

const VALID_REGISTRIES = new Set<string>(["npm", "pypi", "crates", "go"]);

function parseQueries(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((q) => q.trim())
    .filter(Boolean);
}

function formatResult(item: PackageSearchResultItem): string {
  const header = [
    `### ${item.package_name}@${item.version}`,
    item.description ?? "",
    item.repository_url ? `Repository: ${item.repository_url}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (item.code_results.length === 0) {
    return `${header}\n\nNo code results found.`;
  }

  const codeBlocks = item.code_results.map(
    (cr) => `**${cr.file_path}** (score: ${cr.score.toFixed(2)})\n\`\`\`\n${cr.content}\n\`\`\``,
  );

  return `${header}\n\n${codeBlocks.join("\n\n")}`;
}

function formatResponse(data: PackageSearchResponse): string {
  if (data.results.length === 0) {
    return "No results found for the given package search.";
  }

  const formatted = data.results.map(formatResult);
  return [`Found ${data.total} result(s):`, "", ...formatted].join("\n");
}

export function createNiaPackageSearchTool(client: NiaClient, config: NiaConfig) {
  return tool({
    description:
      "Search package source code across registries (npm, pypi, crates, go). Find usage examples, API patterns, and implementation details within packages.",
    args: {
      registry: tool.schema
        .enum(["npm", "pypi", "crates", "go"])
        .describe("Package registry to search"),
      package_name: tool.schema.string().describe("Package name to search"),
      semantic_queries: tool.schema
        .string()
        .optional()
        .describe("Comma-separated semantic search queries (e.g. 'streaming,chat completion')"),
      pattern: tool.schema
        .string()
        .optional()
        .describe("Code pattern to search for within the package"),
    },
    async execute(args, context) {
      if (!args.registry || !VALID_REGISTRIES.has(args.registry)) {
        return `error: registry is required and must be one of: ${[...VALID_REGISTRIES].join(", ")}`;
      }

      if (!args.package_name?.trim()) {
        return "error: package_name is required";
      }

      const body: Record<string, unknown> = {
        registry: args.registry,
        package_name: args.package_name,
      };

      const queries = parseQueries(args.semantic_queries);
      if (queries) {
        body.semantic_queries = queries;
      }

      if (args.pattern) {
        body.code_snippets = [args.pattern];
      }

      const result = await client.post<PackageSearchResponse>(
        "/package-search/hybrid",
        body,
        context.abort,
      );

      if (typeof result === "string") return result;

      return formatResponse(result);
    },
  });
}
