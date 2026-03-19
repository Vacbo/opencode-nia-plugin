import { tool } from "@opencode-ai/plugin";

import { NiaClient } from "../api/client.js";
import type { DeepSearchResponse, OracleJobResponse, SearchResultItem, WebSearchResponse } from "../api/types.js";
import { CONFIG, type NiaConfig } from "../config.js";

const z = tool.schema;

const ABORT_ERROR = "abort_error [nia_research]: request aborted";
const MAX_NUM_RESULTS = 20;
const ORACLE_TIMEOUT_MS = 60_000;
const TERMINAL_STATUSES = new Set(["completed", "error", "failed", "cancelled"]);

type ResearchClient = {
  post: (path: string, body?: unknown, signal?: AbortSignal, timeout?: number) => Promise<unknown>;
  get: (path: string, params?: unknown, signal?: AbortSignal, timeout?: number) => Promise<unknown>;
};

type ResearchConfig = Pick<NiaConfig, "apiKey" | "researchEnabled" | "apiUrl">;

type WebResult = {
  title?: string;
  url?: string;
  snippet?: string;
  score?: number;
};

type OracleJobLike = OracleJobResponse & { job_id?: string };

type NormalizedResult = {
  title: string;
  excerpt: string;
  url?: string;
  filePath?: string;
  score?: number;
  sourceType?: string;
  highlights?: string[];
};

const niaResearchArgsShape = {
  query: z.string().trim().min(1).optional(),
  mode: z.enum(["quick", "deep", "oracle"]).default("quick"),
  job_id: z.string().trim().min(1).optional(),
  num_results: z.number().int().positive().max(MAX_NUM_RESULTS).optional(),
};

export const niaResearchArgsSchema = z.object(niaResearchArgsShape).superRefine((args, context) => {
  if (!args.job_id && !args.query) {
    context.addIssue({
      code: "custom",
      path: ["query"],
      message: "query is required when job_id is not provided",
    });
  }

  if (args.job_id && args.mode !== "oracle") {
    context.addIssue({
      code: "custom",
      path: ["job_id"],
      message: "job_id is only supported in oracle mode",
    });
  }
});

export interface NiaResearchArgs {
  query?: string;
  mode: "quick" | "deep" | "oracle";
  job_id?: string;
  num_results?: number;
}

export interface CreateNiaResearchToolOptions {
  config?: Partial<ResearchConfig>;
  client?: ResearchClient;
}

export function createNiaResearchTool(options: CreateNiaResearchToolOptions = {}) {
  return tool({
    description: "Run quick, deep, or oracle research with Nia.",
    args: niaResearchArgsShape,
    async execute(rawArgs, context) {
      try {
        const args = niaResearchArgsSchema.parse(rawArgs);
        if (context.abort.aborted) {
          return ABORT_ERROR;
        }

        const config = resolveConfig(options.config);
        const configError = validateConfig(config);
        if (configError) {
          return configError;
        }

        const client =
          options.client ??
          new NiaClient({
            apiKey: config.apiKey!,
            baseUrl: config.apiUrl,
          });

        if (args.job_id) {
          const response = (await client.get(
            `/oracle/jobs/${encodeURIComponent(args.job_id)}`,
            undefined,
            context.abort,
            ORACLE_TIMEOUT_MS
          )) as string | OracleJobLike;

          if (typeof response === "string") {
            return response;
          }

          return formatOracleResponse(response, { query: args.query, submitted: false });
        }

        switch (args.mode) {
          case "quick": {
            const response = (await client.post(
              "/search/web",
              buildQuickBody(args),
              context.abort
            )) as string | WebSearchResponse;

            if (typeof response === "string") {
              return response;
            }

            return formatQuickResponse(args, response);
          }

          case "deep": {
            const response = (await client.post(
              "/search/deep",
              buildDeepBody(args),
              context.abort
            )) as string | DeepSearchResponse;

            if (typeof response === "string") {
              return response;
            }

            return formatDeepResponse(args, response);
          }

          case "oracle": {
            const response = (await client.post(
              "/oracle/jobs",
              buildOracleBody(args),
              context.abort,
              ORACLE_TIMEOUT_MS
            )) as string | OracleJobLike;

            if (typeof response === "string") {
              return response;
            }

            return formatOracleResponse(response, { query: args.query, submitted: true });
          }
        }
      } catch (error) {
        return formatUnexpectedError(error, context.abort.aborted);
      }
    },
  });
}

export const niaResearchTool = createNiaResearchTool();

export default niaResearchTool;

function resolveConfig(config?: Partial<ResearchConfig>): ResearchConfig {
  return {
    apiKey: config?.apiKey ?? CONFIG.apiKey,
    researchEnabled: config?.researchEnabled ?? CONFIG.researchEnabled,
    apiUrl: config?.apiUrl ?? CONFIG.apiUrl,
  };
}

function validateConfig(config: ResearchConfig): string | undefined {
  if (!config.researchEnabled) {
    return "config_error: nia research is disabled";
  }

  if (!config.apiKey) {
    return "config_error: NIA_API_KEY is not set";
  }

  return undefined;
}

function buildQuickBody(args: NiaResearchArgs): Record<string, unknown> {
  return {
    query: args.query,
    ...(args.num_results !== undefined ? { num_results: args.num_results } : {}),
  };
}

function buildDeepBody(args: NiaResearchArgs): Record<string, unknown> {
  return {
    query: args.query,
    output_format: "markdown",
    ...(args.num_results !== undefined ? { num_results: args.num_results } : {}),
  };
}

function buildOracleBody(args: NiaResearchArgs): Record<string, unknown> {
  return {
    query: args.query,
    output_format: "markdown",
    ...(args.num_results !== undefined ? { num_results: args.num_results } : {}),
  };
}

function formatQuickResponse(args: NiaResearchArgs, response: WebSearchResponse): string {
  const headerLines = [
    "# Nia Research",
    `- Mode: ${inlineCode(args.mode)}`,
    `- Query: ${inlineCode(response.query || args.query || "")}`,
  ];

  const sections = [headerLines.join("\n")];
  const results = normalizeWebResults(response.results ?? []);

  if (results.length > 0) {
    sections.push(`## Results\n${formatResults(results)}`);
  } else {
    sections.push(`No results found for ${inlineCode(args.query || response.query || "")}.`);
  }

  return sections.join("\n\n");
}

function formatDeepResponse(args: NiaResearchArgs, response: DeepSearchResponse): string {
  const headerLines = [
    "# Nia Research",
    `- Mode: ${inlineCode(args.mode)}`,
    `- Query: ${inlineCode(args.query || "")}`,
  ];

  if (response.id) {
    headerLines.push(`- Research ID: ${inlineCode(response.id)}`);
  }

  if (response.status) {
    headerLines.push(`- Status: ${inlineCode(response.status)}`);
  }

  const sections = [headerLines.join("\n")];

  if (response.result?.trim()) {
    sections.push(`## Result\n${response.result}`);
  }

  const sources = normalizeSearchResults(response.sources ?? []);
  if (sources.length > 0) {
    sections.push(`## Sources\n${formatResults(sources)}`);
  }

  if (response.citations?.length) {
    sections.push(`## Citations\n${response.citations.map((citation) => `- ${citation}`).join("\n")}`);
  }

  if (!response.result?.trim() && sources.length === 0) {
    sections.push(`No research results found for ${inlineCode(args.query || "")}.`);
  }

  return sections.join("\n\n");
}

function formatOracleResponse(
  response: OracleJobLike,
  options: {
    query?: string;
    submitted: boolean;
  }
): string {
  const jobId = getOracleJobId(response);
  const headerLines = ["# Nia Research", `- Mode: ${inlineCode("oracle")}`];

  if (jobId) {
    headerLines.push(`- Job ID: ${inlineCode(jobId)}`);
  }

  if (response.status) {
    headerLines.push(`- Status: ${inlineCode(response.status)}`);
  }

  const query = response.query || options.query;
  if (query) {
    headerLines.push(`- Query: ${inlineCode(query)}`);
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

  const sources = normalizeSearchResults(response.sources ?? []);
  if (sources.length > 0) {
    sections.push(`## Sources\n${formatResults(sources)}`);
  }

  if (response.error?.trim()) {
    sections.push(`## Error\n${response.error}`);
  }

  if (!response.result?.trim() && sources.length === 0 && response.status && !isTerminalStatus(response.status)) {
    sections.push(`Oracle job is still ${inlineCode(response.status)}.`);
  }

  if (!response.result?.trim() && sources.length === 0 && isTerminalStatus(response.status) && !response.error?.trim()) {
    sections.push("No oracle result returned.");
  }

  if (options.submitted && jobId && !isTerminalStatus(response.status)) {
    sections.push(`Re-run this tool with \`job_id\` set to ${inlineCode(jobId)} to check status.`);
  }

  return sections.join("\n\n");
}

function normalizeWebResults(results: WebResult[]): NormalizedResult[] {
  return results.map((result) => ({
    title: stringOrFallback(result.title, result.url, "Untitled result"),
    excerpt: stringOrFallback(result.snippet, "No excerpt available."),
    url: typeof result.url === "string" ? result.url : undefined,
    score: typeof result.score === "number" ? result.score : undefined,
  }));
}

function normalizeSearchResults(results: SearchResultItem[]): NormalizedResult[] {
  return results.map((result) => ({
    title: stringOrFallback(result.title, result.file_path, result.url, "Untitled result"),
    excerpt: stringOrFallback(result.content, "No excerpt available."),
    url: typeof result.url === "string" ? result.url : undefined,
    filePath: typeof result.file_path === "string" ? result.file_path : undefined,
    score: typeof result.score === "number" ? result.score : undefined,
    sourceType: typeof result.source_type === "string" ? result.source_type : undefined,
    highlights: Array.isArray(result.highlights)
      ? result.highlights.filter((value): value is string => typeof value === "string")
      : undefined,
  }));
}

function formatResults(results: NormalizedResult[]): string {
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

      if (result.highlights?.length) {
        lines.push(`   - Highlights: ${result.highlights.join(", ")}`);
      }

      lines.push(`   - Excerpt: ${result.excerpt}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function getOracleJobId(response: OracleJobLike): string | undefined {
  return response.id || response.job_id;
}

function isTerminalStatus(status: string | undefined): boolean {
  return status ? TERMINAL_STATUSES.has(status) : false;
}

function stringOrFallback(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "";
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

function formatUnexpectedError(error: unknown, wasAborted: boolean): string {
  if (wasAborted || isAbortError(error)) {
    return ABORT_ERROR;
  }

  if (isZodError(error)) {
    return `validation_error: ${error.issues.map((issue) => issue.message).join("; ")}`;
  }

  if (error instanceof Error) {
    return `research_error: ${error.message}`;
  }

  return `research_error: ${String(error)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : false;
}

function isZodError(error: unknown): error is Error & { issues: Array<{ message: string }> } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}
