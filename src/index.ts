import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";

import { createSdkAdapter, type SdkAdapter } from "./api/nia-sdk.js";
import { setOpencodeClient } from "./opencode-client.js";

import { isConfigured, loadConfig, type NiaConfig } from "./config.js";
import { OpsTracker } from "./state/ops-tracker.js";
import {
  detectTrigger,
  NIA_NUDGE_MESSAGE,
  NIA_SAVE_NUDGE_MESSAGE,
  NIA_URL_NUDGE_MESSAGE,
} from "./hooks/smart-triggers.js";
import { log } from "./services/logger.js";
import { getSessionState, removeSessionState, resetSessionStates } from "./state/session.js";
import { createNiaAdvisorTool } from "./tools/nia-advisor.js";
import { createNiaAutoSubscribeTool } from "./tools/nia-auto-subscribe.js";
import { createNiaContextTool } from "./tools/nia-context.js";
import { createNiaE2ETool } from "./tools/nia-e2e.js";
import { createNiaExploreTool } from "./tools/nia-explore.js";
import { createNiaGrepTool } from "./tools/nia-grep.js";
import { createNiaIndexTool } from "./tools/nia-index.js";
import { createNiaManageResourceTool } from "./tools/nia-manage-resource.js";
import { createNiaMkdirTool } from "./tools/nia-mkdir.js";
import { createNiaMvTool } from "./tools/nia-mv.js";
import { createNiaPackageSearchTool } from "./tools/nia-package-search.js";
import { createNiaReadTool } from "./tools/nia-read.js";
import { createNiaResearchTool } from "./tools/nia-research.js";
import { createNiaRmTool } from "./tools/nia-rm.js";
import { createNiaSearchTool } from "./tools/nia-search.js";
import { createNiaTracerTool } from "./tools/nia-tracer.js";
import { createNiaWriteTool } from "./tools/nia-write.js";

function createClient(config: NiaConfig): SdkAdapter {
	const apiKey = config.apiKey;
	if (!apiKey) {
		throw new Error("NIA_API_KEY is required but not set");
	}

	return createSdkAdapter(config);
}

function createToolRegistry(config: NiaConfig, client: SdkAdapter) {
	const e2eTool = config.e2eEnabled ? createNiaE2ETool(client, config) : null;

	return {
		nia_search: createNiaSearchTool(client, config),
		nia_read: createNiaReadTool(client, config),
		nia_write: createNiaWriteTool(client, config),
		nia_rm: createNiaRmTool(client, config),
		nia_mv: createNiaMvTool(client, config),
		nia_mkdir: createNiaMkdirTool(client, config),
		nia_grep: createNiaGrepTool(client, config),
		nia_explore: createNiaExploreTool(client, config),
		nia_index: createNiaIndexTool(client, config),
		nia_manage_resource: createNiaManageResourceTool(client, config),
		...(config.researchEnabled
			? { nia_research: createNiaResearchTool(client, config) }
			: {}),
		...(config.advisorEnabled
			? { nia_advisor: createNiaAdvisorTool(client, config) }
			: {}),
		...(config.contextEnabled
			? { nia_context: createNiaContextTool(client, config) }
			: {}),
		nia_package_search: createNiaPackageSearchTool(client, config),
		nia_auto_subscribe: createNiaAutoSubscribeTool(client, config),
		...(config.tracerEnabled
			? { nia_tracer: createNiaTracerTool(client, config) }
			: {}),
		...(e2eTool ? { nia_e2e: e2eTool } : {}),
	};
}

export const NiaPlugin: Plugin = async ({ client, directory }: PluginInput) => {
 	setOpencodeClient(client);
	const config = loadConfig();
	const configured = isConfigured();

 	log("Plugin initialized", { directory, configured });

 	if (!configured) {
		log("Plugin disabled - NIA_API_KEY not set");
		return {};
	}

 	const niaClient = createClient(config);
	const opsTracker = new OpsTracker({ checkInterval: config.checkInterval });
	opsTracker.setClient(niaClient);

 	return {
		event: async ({ event }) => {
			if (event.type === "session.deleted") {
				removeSessionState(event.properties.info.id);
			}

			if (event.type === "server.instance.disposed") {
				resetSessionStates();
			}
		},
		tool: createToolRegistry(config, niaClient),
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
					(part): part is Part & { type: "text"; text: string } =>
						part.type === "text",
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

				const { type, match, deduplicated } = detectTrigger(
					userMessage,
					sessionState.triggerSession,
				);

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
					id: `prt_nia_${type}_nudge_${Date.now()}`,
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
