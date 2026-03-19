import { tool } from "@opencode-ai/plugin";

import { NiaClient } from "../api/client.js";
import type { TracerResultItem } from "../api/types.js";
import { CONFIG, type NiaConfig } from "../config.js";

const z = tool.schema;

const ABORT_ERROR = "abort_error [nia_tracer]: request aborted";
const DEFAULT_TIMEOUT_SECONDS = 120;
const TERMINAL_STATUSES = new Set(["completed", "failed", "error", "cancelled"]);

export type TracerMode = "tracer-fast" | "tracer-deep";

type TracerQueryValue = string | number | boolean | Array<string | number | boolean> | null | undefined;
type TracerQueryParams = Record<string, TracerQueryValue>;

type TracerClient = {
  post: (path: string, body?: unknown, signal?: AbortSignal, timeout?: number) => Promise<unknown>;
  get: (path: string, params?: TracerQueryParams, signal?: AbortSignal, timeout?: number) => Promise<unknown>;
  delete?: (path: string, body?: unknown, signal?: AbortSignal, timeout?: number) => Promise<unknown>;
};

type TracerConfig = Pick<NiaConfig, "apiKey" | "tracerEnabled" | "apiUrl" | "tracerTimeout">;

type TracerJobResponse = {
  id?: string;
  job_id?: string;
  session_id?: string;
  status?: string;
  query?: string;
  created_at?: string;
  completed_at?: string;
  result?: string;
  results?: TracerResultItem[];
  error?: string;
};

type FormatTracerResponseOptions = {
  mode?: TracerMode;
  query?: string;
};

export interface NiaTracerArgs {
  query?: string;
  repositories?: string[];
  tracer_mode: TracerMode;
  job_id?: string;
}

export interface CreateNiaTracerToolOptions {
  config?: Partial<TracerConfig>;
  client?: TracerClient;
}

const niaTracerArgsShape = {
  query: z.string().trim().min(1).optional(),
  repositories: z.array(z.string().trim().min(1)).optional(),
  tracer_mode: z.enum(["tracer-fast", "tracer-deep"]).default("tracer-fast"),
  job_id: z.string().trim().min(1).optional(),
};

export const niaTracerArgsSchema = z.object(niaTracerArgsShape).superRefine((
  args: any,
  context: any
) => {
  if (!args.job_id && !args.query) {
    context.addIssue({
      code: "custom",
      path: ["query"],
      message: "query is required when job_id is not provided",
    });
  }
});

export function createNiaTracerTool(options: CreateNiaTracerToolOptions = {}) {
  return tool({
    description: "Search public GitHub repositories with Nia Tracer in fast or deep mode.",
    args: niaTracerArgsShape,
    async execute(rawArgs, context) {
      try {
        const args = niaTracerArgsSchema.parse(rawArgs);
        if (context.abort.aborted) {
          return ABORT_ERROR;
        }

        const config = resolveConfig(options.config);
        const configError = validateConfig(config);
        if (configError) {
          return configError;
        }

        const timeoutMs = resolveTracerTimeoutMs(config);
        const client = options.client ?? new NiaClient({
          apiKey: config.apiKey!,
          baseUrl: config.apiUrl,
          timeout: timeoutMs,
        });

        if (args.job_id) {
          const response = (await client.get(
            `/github/tracer/${encodeURIComponent(args.job_id)}`,
            undefined,
            context.abort,
            timeoutMs
          )) as string | TracerJobResponse;

          if (typeof response === "string") {
            return response;
          }

          return formatTracerResponse(response, { query: args.query });
        }

        const response = (await client.post(
          "/github/tracer",
          buildCreateBody(args),
          context.abort,
          timeoutMs
        )) as string | TracerJobResponse;

        if (typeof response === "string") {
          return response;
        }

        if (args.tracer_mode === "tracer-deep") {
          const jobId = getJobId(response);
          if (!jobId) {
            return "invalid_response: missing job_id in Nia tracer response";
          }

          return formatQueuedResponse(response, args.tracer_mode, args.query);
        }

        if (hasInlineResult(response) || isTerminalStatus(response.status)) {
          return formatTracerResponse(response, { mode: args.tracer_mode, query: args.query });
        }

        const jobId = getJobId(response);
        if (!jobId) {
          return "invalid_response: missing job_id in Nia tracer response";
        }

        return formatQueuedResponse(response, args.tracer_mode, args.query);
      } catch (error) {
        return formatUnexpectedError(error, context.abort.aborted);
      }
    },
  });
}

export const niaTracerTool = createNiaTracerTool();

export default niaTracerTool;

function resolveConfig(config?: Partial<TracerConfig>): TracerConfig {
  return {
    apiKey: config?.apiKey ?? CONFIG.apiKey,
    tracerEnabled: config?.tracerEnabled ?? CONFIG.tracerEnabled,
    apiUrl: config?.apiUrl ?? CONFIG.apiUrl,
    tracerTimeout: config?.tracerTimeout ?? CONFIG.tracerTimeout,
  };
}

function validateConfig(config: TracerConfig): string | undefined {
  if (!config.tracerEnabled) {
    return "config_error: nia tracer is disabled";
  }

  if (!config.apiKey) {
    return "config_error: NIA_API_KEY is not set";
  }

  return undefined;
}

function resolveTracerTimeoutMs(config: Partial<TracerConfig>): number {
  const timeoutSeconds = config.tracerTimeout ?? DEFAULT_TIMEOUT_SECONDS;
  return Math.max(1, timeoutSeconds * 1000);
}

function buildCreateBody(args: NiaTracerArgs): Record<string, unknown> {
  return {
    query: args.query,
    repositories: args.repositories,
    mode: args.tracer_mode,
  };
}

function formatQueuedResponse(response: TracerJobResponse, mode: TracerMode, query?: string): string {
  const message = formatTracerResponse(response, { mode, query });
  const jobId = getJobId(response);

  if (!jobId || isTerminalStatus(response.status)) {
    return message;
  }

  return `${message}\n\nRe-run this tool with \`job_id\` set to ${inlineCode(jobId)} to check status.`;
}

function formatTracerResponse(response: TracerJobResponse, options: FormatTracerResponseOptions = {}): string {
  const headerLines = ["# Nia Tracer"];
  const jobId = getJobId(response);

  if (options.mode) {
    headerLines.push(`- Mode: ${inlineCode(options.mode)}`);
  }

  if (jobId) {
    headerLines.push(`- Job ID: ${inlineCode(jobId)}`);
  }

  if (response.status) {
    headerLines.push(`- Status: ${inlineCode(response.status)}`);
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
      sections.push(`Tracer job is still ${inlineCode(response.status)}.`);
    } else if (response.status === "completed") {
      sections.push("No tracer results returned.");
    }
  }

  return sections.join("\n\n");
}

function formatMatches(results: TracerResultItem[]): string {
  return results
    .map((result, index) => {
      const location = result.line_number !== undefined ? `${result.path}:${result.line_number}` : result.path;
      const lines = [`${index + 1}. ${inlineCode(location)}`];

      if (result.repository) {
        lines.push(`   - Repository: ${inlineCode(result.repository)}`);
      }

      if (typeof result.score === "number") {
        lines.push(`   - Score: ${result.score.toFixed(2)}`);
      }

      lines.push(`   - Snippet: ${result.content}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function getJobId(response: TracerJobResponse): string | undefined {
  return response.job_id ?? response.id;
}

function hasInlineResult(response: TracerJobResponse): boolean {
  return Boolean(response.result?.trim()) || (Array.isArray(response.results) && response.results.length > 0);
}

function isTerminalStatus(status: string | undefined): boolean {
  return status ? TERMINAL_STATUSES.has(status) : false;
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
    return `tracer_error: ${error.message}`;
  }

  return `tracer_error: ${String(error)}`;
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
