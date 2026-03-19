import { tool } from "@opencode-ai/plugin";

import type { NiaClient } from "../api/client.js";

interface DependencyItem {
  name: string;
  version: string;
  ecosystem: string;
  status: string;
}

interface AutoSubscribeResponse {
  dependencies: DependencyItem[];
  total_new: number;
  total_existing: number;
}

function formatDependency(dep: DependencyItem): string {
  return `- ${dep.name}@${dep.version} (${dep.ecosystem}) — ${dep.status}`;
}

function formatResponse(data: AutoSubscribeResponse, isDryRun: boolean): string {
  const mode = isDryRun ? "Dry run" : "Subscribed";
  const header = `**${mode}** — ${data.total_new} new, ${data.total_existing} already tracked`;

  if (data.dependencies.length === 0) {
    return `${header}\n\nNo dependencies found in manifest.`;
  }

  const items = data.dependencies.map(formatDependency);
  return [header, "", ...items].join("\n");
}

export function createAutoSubscribeTool(client: NiaClient) {
  return tool({
    description:
      "Parse a project manifest (package.json, requirements.txt, Cargo.toml, go.mod) and subscribe to documentation updates for all dependencies. Defaults to dry_run mode to preview changes.",
    args: {
      manifest_content: tool.schema
        .string()
        .describe("Raw content of the manifest file"),
      manifest_type: tool.schema
        .string()
        .describe("Manifest file type (package.json, requirements.txt, Cargo.toml, go.mod)"),
      dry_run: tool.schema
        .string()
        .optional()
        .describe("Preview mode (default: 'true'). Set to 'false' to actually subscribe — requires permission."),
    },
    async execute(args, context) {
      if (!args.manifest_content?.trim()) {
        return "error: manifest_content is required";
      }

      if (!args.manifest_type?.trim()) {
        return "error: manifest_type is required";
      }

      const isDryRun = args.dry_run !== "false";

      if (!isDryRun) {
        await context.ask({
          permission: "Subscribe to dependency documentation updates",
          patterns: ["nia:auto-subscribe:live"],
          always: ["nia:auto-subscribe"],
          metadata: { manifestType: args.manifest_type },
        });
      }

      const body = {
        manifest_content: args.manifest_content,
        manifest_type: args.manifest_type,
        dry_run: isDryRun,
      };

      const result = await client.post<AutoSubscribeResponse>(
        "/dependencies",
        body,
        context.abort,
      );

      if (typeof result === "string") return result;

      return formatResponse(result, isDryRun);
    },
  });
}
