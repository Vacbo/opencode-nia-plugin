import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";

import { NiaClient } from "./api/client.js";
import { isConfigured } from "./config.js";
import { detectKeyword, NIA_NUDGE_MESSAGE, NIA_SAVE_NUDGE_MESSAGE } from "./keywords.js";
import { log } from "./services/logger.js";
import { createNiaE2ETool } from "./tools/nia-e2e.js";
import { createNiaIndexTool } from "./tools/nia-index.js";
import { createNiaManageResourceTool } from "./tools/nia-manage-resource.js";
import { createNiaResearchTool } from "./tools/nia-research.js";
import { createNiaTracerTool } from "./tools/nia-tracer.js";

function createClient(): NiaClient | undefined {
  const apiKey = process.env.NIA_API_KEY;

  if (!apiKey) {
    return undefined;
  }

  return new NiaClient({
    apiKey,
    baseUrl: process.env.NIA_API_URL,
  });
}

export const NiaPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;

  log("Plugin initialized", { directory, configured: isConfigured() });

  if (!isConfigured()) {
    log("Plugin disabled - NIA_API_KEY not set");
  }

  const client = createClient();
  const e2eTool = client ? createNiaE2ETool(client) : undefined;

  return {
    tool: {
      nia_index: createNiaIndexTool(createClient),
      nia_manage_resource: createNiaManageResourceTool(createClient),
      nia_research: createNiaResearchTool(),
      nia_tracer: createNiaTracerTool(),
      ...(e2eTool ? { nia_e2e: e2eTool } : {}),
    },
    "chat.message": async (input, output) => {
      if (!isConfigured()) return;

      const start = Date.now();

      try {
        const textParts = output.parts.filter(
          (p): p is Part & { type: "text"; text: string } => p.type === "text"
        );

        if (textParts.length === 0) {
          log("chat.message: no text parts found");
          return;
        }

        const userMessage = textParts.map((p) => p.text).join("\n");

        if (!userMessage.trim()) {
          log("chat.message: empty message, skipping");
          return;
        }

        log("chat.message: processing", {
          messagePreview: userMessage.slice(0, 100),
          partsCount: output.parts.length,
        });

        const { type, match } = detectKeyword(userMessage);

        if (type) {
          const nudgeText = type === "save" ? NIA_SAVE_NUDGE_MESSAGE : NIA_NUDGE_MESSAGE;
          log(`chat.message: ${type} keyword detected`, { match });

          const nudgePart: Part = {
            id: `nia-${type}-nudge-${Date.now()}`,
            sessionID: input.sessionID,
            messageID: output.message.id,
            type: "text",
            text: nudgeText,
            synthetic: true,
          };

          output.parts.push(nudgePart);

          const duration = Date.now() - start;
          log(`chat.message: ${type} nudge injected`, { duration, match });
        }
      } catch (error) {
        log("chat.message: ERROR", { error: String(error) });
      }
    },
  };
};

export default NiaPlugin;
