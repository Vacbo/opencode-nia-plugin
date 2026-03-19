import type { Plugin } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";

import { NiaClient } from "./api/client.js";
import type { IOpsTracker, PendingOperation } from "./api/types.js";
import { isConfigured, loadConfig, type NiaConfig } from "./config.js";
import {
  createTriggerSession,
  detectTrigger,
  NIA_NUDGE_MESSAGE,
  NIA_SAVE_NUDGE_MESSAGE,
  NIA_URL_NUDGE_MESSAGE,
  type TriggerSession,
} from "./hooks/smart-triggers.js";
import { log } from "./services/logger.js";
import { createNiaAdvisorTool } from "./tools/nia-advisor.js";
import { createAutoSubscribeTool as createNiaAutoSubscribeTool } from "./tools/nia-auto-subscribe.js";
import { createContextTool as createNiaContextTool } from "./tools/nia-context.js";
import { createNiaE2ETool } from "./tools/nia-e2e.js";
import { createNiaExploreTool } from "./tools/nia-explore.js";
import { createNiaGrepTool } from "./tools/nia-grep.js";
import { createNiaIndexTool } from "./tools/nia-index.js";
import { createNiaManageResourceTool } from "./tools/nia-manage-resource.js";
import { createPackageSearchTool as createNiaPackageSearchTool } from "./tools/nia-package-search.js";
import { createNiaReadTool } from "./tools/nia-read.js";
import { createNiaResearchTool } from "./tools/nia-research.js";
import { createNiaSearchTool } from "./tools/nia-search.js";
import { createNiaTracerTool } from "./tools/nia-tracer.js";

type PluginSessionState = {
  triggerSession: TriggerSession;
  toolExecuteAfterCount: number;
  systemTransformCount: number;
};

function createClient(config: NiaConfig): NiaClient {
  return new NiaClient({
    apiKey: config.apiKey!,
    baseUrl: config.apiUrl,
  });
}

function createSessionStateFactory() {
  const sessions = new Map<string, PluginSessionState>();

  return (sessionID: string): PluginSessionState => {
    let state = sessions.get(sessionID);

    if (!state) {
      state = {
        triggerSession: createTriggerSession(),
        toolExecuteAfterCount: 0,
        systemTransformCount: 0,
      };
      sessions.set(sessionID, state);
    }

    return state;
  };
}

function createOpsTracker(): IOpsTracker {
  const operations = new Map<string, PendingOperation>();

  return {
    trackOperation(operation) {
      operations.set(operation.id, operation);
    },
    getOperation(id) {
      return operations.get(id);
    },
    getAllOperations() {
      return [...operations.values()];
    },
    removeOperation(id) {
      operations.delete(id);
    },
  };
}

function createToolRegistry(config: NiaConfig, client: NiaClient) {
  const resolveClient = () => client;
  const researchClient = {
    post: (path: string, body?: unknown, signal?: AbortSignal, timeout?: number) =>
      client.post(path, body, signal, timeout),
    get: (path: string, params?: unknown, signal?: AbortSignal, timeout?: number) =>
      client.get(path, params as never, signal, timeout),
  };

  return {
    nia_search: createNiaSearchTool({ config, client }),
    nia_read: createNiaReadTool(client),
    nia_grep: createNiaGrepTool(client),
    nia_explore: createNiaExploreTool(client),
    nia_index: createNiaIndexTool(resolveClient),
    nia_manage_resource: createNiaManageResourceTool(resolveClient),
    ...(config.researchEnabled ? { nia_research: createNiaResearchTool({ config, client: researchClient }) } : {}),
    ...(config.advisorEnabled ? { nia_advisor: createNiaAdvisorTool({ config, client }) } : {}),
    ...(config.contextEnabled ? { nia_context: createNiaContextTool(client) } : {}),
    nia_package_search: createNiaPackageSearchTool(client),
    nia_auto_subscribe: createNiaAutoSubscribeTool(client),
    ...(config.tracerEnabled ? { nia_tracer: createNiaTracerTool({ config, client }) } : {}),
    ...(config.e2eEnabled ? { nia_e2e: createNiaE2ETool(client, config.e2eEnabled) } : {}),
  };
}

export const NiaPlugin: Plugin = async ({ directory }) => {
  const config = loadConfig();
  const configured = isConfigured();

  log("Plugin initialized", { directory, configured });

  if (!configured) {
    log("Plugin disabled - NIA_API_KEY not set");
    return {};
  }

  const client = createClient(config);
  const getSessionState = createSessionStateFactory();
  const opsTracker = createOpsTracker();

  return {
    tool: createToolRegistry(config, client),
    "tool.execute.after": async (input) => {
      const sessionState = getSessionState(input.sessionID);
      sessionState.toolExecuteAfterCount += 1;
      void opsTracker.getAllOperations();
    },
    "experimental.chat.system.transform": async (input) => {
      const sessionState = getSessionState(input.sessionID ?? "__system__");
      sessionState.systemTransformCount += 1;
      void opsTracker.getAllOperations();
    },
    "chat.message": async (input, output) => {
      if (!config.triggersEnabled) {
        return;
      }

      const start = Date.now();

      try {
        const sessionState = getSessionState(input.sessionID);
        const textParts = output.parts.filter(
          (part): part is Part & { type: "text"; text: string } => part.type === "text"
        );

        if (textParts.length === 0) {
          log("chat.message: no text parts found");
          return;
        }

        const userMessage = textParts.map((part) => part.text).join("\n");

        if (!userMessage.trim()) {
          log("chat.message: empty message, skipping");
          return;
        }

        log("chat.message: processing", {
          messagePreview: userMessage.slice(0, 100),
          partsCount: output.parts.length,
        });

        const { type, match, deduplicated } = detectTrigger(userMessage, sessionState.triggerSession);

        if (deduplicated) {
          log("chat.message: trigger deduplicated", { match });
          return;
        }

        if (!type) {
          return;
        }

        const nudgeText =
          type === "save"
            ? NIA_SAVE_NUDGE_MESSAGE
            : type === "url"
              ? NIA_URL_NUDGE_MESSAGE
              : NIA_NUDGE_MESSAGE;

        log(`chat.message: ${type} trigger detected`, { match });

        output.parts.push({
          id: `nia-${type}-nudge-${Date.now()}`,
          sessionID: input.sessionID,
          messageID: output.message.id,
          type: "text",
          text: nudgeText,
          synthetic: true,
        });

        log(`chat.message: ${type} nudge injected`, {
          duration: Date.now() - start,
          match,
        });
      } catch (error) {
        log("chat.message: ERROR", { error: String(error) });
      }
    },
  };
};

export default NiaPlugin;
