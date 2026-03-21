import { tool } from "@opencode-ai/plugin";

import type { NiaClient } from "../api/client.js";
import type { NiaConfig } from "../config.js";

import type { AdvisorResult } from "../api/types.js";

const ABORT_ERROR = "abort_error [nia_advisor]: request aborted";
const z = tool.schema;

const niaAdvisorArgsShape = {
  query: z.string().trim().min(1, "query is required"),
  codebase: z.string().trim().min(1).optional(),
  search_scope: z.string().trim().min(1).optional(),
  output_format: z.string().trim().min(1).optional(),
};

export const niaAdvisorArgsSchema = tool.schema.object(niaAdvisorArgsShape);

export interface NiaAdvisorArgs {
  query: string;
  codebase?: string;
  search_scope?: string;
  output_format?: string;
}

export function createNiaAdvisorTool(client: NiaClient, config: NiaConfig) {
  return tool({
    description: "Get Nia advice for a query with markdown recommendations",
    args: niaAdvisorArgsShape,
    async execute(rawArgs, context) {
      try {
        const args = niaAdvisorArgsSchema.parse(rawArgs);
        if (context.abort.aborted) {
          return ABORT_ERROR;
        }

        if (!config.advisorEnabled) {
          return "config_error: nia advisor is disabled";
        }

        if (!config.apiKey) {
          return "config_error: NIA_API_KEY is not set";
        }

        const response = (await client.post("/advisor", buildRequestBody(args), context.abort)) as string | AdvisorResult;

        if (typeof response === "string") {
          return response;
        }

        return formatResponse(args, response);
      } catch (error) {
        return formatUnexpectedError(error, context.abort.aborted);
      }
    },
  });
}

function buildRequestBody(args: NiaAdvisorArgs): NiaAdvisorArgs {
  return {
    query: args.query,
    ...(args.codebase ? { codebase: args.codebase } : {}),
    ...(args.search_scope ? { search_scope: args.search_scope } : {}),
    ...(args.output_format ? { output_format: args.output_format } : {}),
  };
}

function formatResponse(args: NiaAdvisorArgs, response: AdvisorResult): string {
  const sections = [
    "# Nia Advisor",
    `- Query: ${inlineCode(args.query)}`,
    ...(args.codebase ? [`- Codebase: ${inlineCode(args.codebase)}`] : []),
    ...(args.search_scope ? [`- Search scope: ${inlineCode(args.search_scope)}`] : []),
    ...(args.output_format ? [`- Requested output: ${inlineCode(args.output_format)}`] : []),
  ];

  if (response.recommendations.length === 0) {
    sections.push(`## Recommendations\nNo advice returned for ${inlineCode(args.query)}.`);
    return sections.join("\n\n");
  }

  sections.push(`## Recommendations\n${formatRecommendations(response.recommendations)}`);

  return sections.join("\n\n");
}

function formatRecommendations(recommendations: AdvisorResult["recommendations"]): string {
  return recommendations
    .map((recommendation, index) => {
      const lines = [`${index + 1}. **${titleCase(recommendation.type)}** - ${recommendation.message}`];

      if (recommendation.source) {
        lines.push(`   - Source: ${inlineCode(recommendation.source)}`);
      }

      lines.push(`   - Confidence: ${formatConfidence(recommendation.confidence)}`);

      return lines.join("\n");
    })
    .join("\n\n");
}

function formatConfidence(confidence: number): string {
  const percent = confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence);
  return `${percent}%`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
    return `advisor_error: ${error.message}`;
  }

  return `advisor_error: ${String(error)}`;
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
