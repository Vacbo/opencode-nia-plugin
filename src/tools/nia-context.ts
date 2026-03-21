import { tool, type ToolContext } from "@opencode-ai/plugin";

import type { NiaClient } from "../api/client.js";
import type { ContextListResponse, ContextResponse } from "../api/types.js";
import type { NiaConfig } from "../config.js";

type ContextAction = "save" | "list" | "retrieve" | "search" | "update" | "delete";

interface ContextArgs {
  action: ContextAction;
  id?: string;
  title?: string;
  summary?: string;
  content?: string;
  tags?: string;
  query?: string;
  limit?: string;
  offset?: string;
}

function parseTags(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function formatContext(ctx: ContextResponse): string {
  const parts = [
    `**${ctx.title}** (${ctx.id})`,
    ctx.summary,
    "",
    ctx.content,
    "",
    `Tags: ${ctx.tags.join(", ") || "none"}`,
    `Created: ${ctx.created_at} | Updated: ${ctx.updated_at}`,
  ];
  return parts.join("\n");
}

function formatList(data: ContextListResponse): string {
  if (data.contexts.length === 0) {
    return `No contexts found. Total: ${data.total}`;
  }

  const items = data.contexts.map(
    (c) => `- **${c.title}** (${c.id}) [${c.tags.join(", ")}] — ${c.summary}`,
  );
  return [`Found ${data.total} context(s):`, "", ...items].join("\n");
}

async function handleSave(client: NiaClient, args: ContextArgs, context: ToolContext): Promise<string> {
  if (!args.title?.trim()) return "error: title is required for save action";
  if (!args.content?.trim()) return "error: content is required for save action";

  const body = {
    title: args.title,
    summary: args.summary ?? "",
    content: args.content,
    tags: parseTags(args.tags),
  };

  const result = await client.post<ContextResponse>("/contexts", body, context.abort);
  if (typeof result === "string") return result;

  return `Context saved successfully.\n\n${formatContext(result)}`;
}

async function handleList(client: NiaClient, args: ContextArgs, context: ToolContext): Promise<string> {
  const params: Record<string, string | number | undefined> = {};
  if (args.limit) params.limit = Number(args.limit);
  if (args.offset) params.offset = Number(args.offset);
  if (args.tags) params.tags = args.tags;

  const result = await client.get<ContextListResponse>("/contexts", params, context.abort);
  if (typeof result === "string") return result;

  return formatList(result);
}

async function handleRetrieve(client: NiaClient, args: ContextArgs, context: ToolContext): Promise<string> {
  if (!args.id?.trim()) return "error: id is required for retrieve action";

  const result = await client.get<ContextResponse>(`/contexts/${args.id}`, undefined, context.abort);
  if (typeof result === "string") return result;

  return formatContext(result);
}

async function handleSearch(client: NiaClient, args: ContextArgs, context: ToolContext): Promise<string> {
  if (!args.query?.trim()) return "error: query is required for search action";

  const params: Record<string, string | number | undefined> = {
    query: args.query,
  };
  if (args.limit) params.limit = Number(args.limit);
  if (args.tags) params.tags = args.tags;

  const result = await client.get<ContextListResponse>("/contexts/semantic-search", params, context.abort);
  if (typeof result === "string") return result;

  return formatList(result);
}

async function handleUpdate(client: NiaClient, args: ContextArgs, context: ToolContext): Promise<string> {
  if (!args.id?.trim()) return "error: id is required for update action";

  const body: Record<string, unknown> = {};
  if (args.title !== undefined) body.title = args.title;
  if (args.summary !== undefined) body.summary = args.summary;
  if (args.content !== undefined) body.content = args.content;
  if (args.tags !== undefined) body.tags = parseTags(args.tags);

  const result = await client.patch<ContextResponse>(`/contexts/${args.id}`, body, context.abort);
  if (typeof result === "string") return result;

  return `Context updated successfully.\n\n${formatContext(result)}`;
}

async function handleDelete(client: NiaClient, args: ContextArgs, context: ToolContext): Promise<string> {
  if (!args.id?.trim()) return "error: id is required for delete action";

  let permission: unknown;
  try {
    permission = await context.ask({
      permission: `Delete context ${args.id}`,
      patterns: [`nia:context:delete:${args.id}`],
      always: ["nia:context:delete"],
      metadata: { contextId: args.id },
    });
  } catch {
    return "error: permission denied";
  }

  if (permission === false) {
    return "error: permission denied";
  }

  const result = await client.delete<{ deleted: boolean }>(`/contexts/${args.id}`, undefined, context.abort);
  if (typeof result === "string") return result;

  return `Context ${args.id} deleted successfully.`;
}

const ACTION_HANDLERS: Record<ContextAction, (client: NiaClient, args: ContextArgs, context: ToolContext) => Promise<string>> = {
  save: handleSave,
  list: handleList,
  retrieve: handleRetrieve,
  search: handleSearch,
  update: handleUpdate,
  delete: handleDelete,
};

export function createNiaContextTool(client: NiaClient, config: NiaConfig) {
  return tool({
    description:
      "Manage Nia knowledge contexts. Save, list, retrieve, search, update, or delete context entries that persist across sessions and agents.",
    args: {
      action: tool.schema
        .enum(["save", "list", "retrieve", "search", "update", "delete"])
        .describe("Action to perform"),
      id: tool.schema.string().optional().describe("Context ID (required for retrieve, update, delete)"),
      title: tool.schema.string().optional().describe("Context title (required for save)"),
      summary: tool.schema.string().optional().describe("Brief summary of the context"),
      content: tool.schema.string().optional().describe("Full context content (required for save)"),
      tags: tool.schema.string().optional().describe("Comma-separated tags for categorization"),
      query: tool.schema.string().optional().describe("Search query (required for search)"),
      limit: tool.schema.string().optional().describe("Max results to return"),
      offset: tool.schema.string().optional().describe("Pagination offset"),
    },
    async execute(args, context) {
      const handler = ACTION_HANDLERS[args.action as ContextAction];
      if (!handler) {
        return `error: unknown action "${args.action}". Valid actions: ${Object.keys(ACTION_HANDLERS).join(", ")}`;
      }

      return handler(client, args as ContextArgs, context);
    },
  });
}
