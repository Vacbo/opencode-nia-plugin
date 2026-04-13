import { type ToolContext, tool } from "@opencode-ai/plugin";

import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";
import { createToolErrorFormatter } from "../utils/format.js";

type FeedbackAction = "answer" | "source" | "interaction";

const VALID_ACTIONS: readonly FeedbackAction[] = ["answer", "source", "interaction"];
const ABORT_ERROR = "abort_error [nia_feedback]: request aborted";
const formatError = createToolErrorFormatter("feedback");

interface FeedbackArgs {
	action: FeedbackAction;
	answer_id?: string;
	source_id?: string;
	interaction_id?: string;
	feedback_type?: string;
	comment?: string;
	metadata?: string;
}

function parseMetadata(raw?: string): Record<string, unknown> | undefined {
	if (!raw) return undefined;
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

async function handleAnswerFeedback(
	client: SdkAdapter,
	args: FeedbackArgs,
): Promise<string> {
	if (!args.answer_id?.trim()) {
		return "error: answer_id is required for answer feedback";
	}
	if (!args.feedback_type?.trim()) {
		return "error: feedback_type is required (e.g., 'thumbs_up', 'thumbs_down')";
	}

	const body = {
		answer_id: args.answer_id,
		feedback_type: args.feedback_type,
		comment: args.comment,
		metadata: parseMetadata(args.metadata),
	};

	await client.post("/feedback/answer", body);

	return `Feedback submitted successfully for answer ${args.answer_id}`;
}

async function handleSourceFeedback(
	client: SdkAdapter,
	args: FeedbackArgs,
): Promise<string> {
	if (!args.source_id?.trim()) {
		return "error: source_id is required for source feedback";
	}
	if (!args.feedback_type?.trim()) {
		return "error: feedback_type is required (e.g., 'helpful', 'not_helpful', 'outdated')";
	}

	const body = {
		source_id: args.source_id,
		feedback_type: args.feedback_type,
		comment: args.comment,
		metadata: parseMetadata(args.metadata),
	};

	await client.post("/feedback/source", body);

	return `Feedback submitted successfully for source ${args.source_id}`;
}

async function handleInteractionFeedback(
	client: SdkAdapter,
	args: FeedbackArgs,
): Promise<string> {
	if (!args.interaction_id?.trim()) {
		return "error: interaction_id is required for interaction feedback";
	}
	if (!args.feedback_type?.trim()) {
		return "error: feedback_type is required (e.g., 'viewed', 'clicked', 'saved')";
	}

	const body = {
		interaction_id: args.interaction_id,
		feedback_type: args.feedback_type,
		comment: args.comment,
		metadata: parseMetadata(args.metadata),
	};

	await client.post("/feedback/interaction", body);

	return `Interaction signal submitted successfully for ${args.interaction_id}`;
}

const ACTION_HANDLERS: Record<
	FeedbackAction,
	(client: SdkAdapter, args: FeedbackArgs) => Promise<string>
> = {
	answer: handleAnswerFeedback,
	source: handleSourceFeedback,
	interaction: handleInteractionFeedback,
};

export function createNiaFeedbackTool(client: SdkAdapter, config: NiaConfig) {
	return tool({
		description:
			"Submit feedback to Nia for answers, sources, or interactions. Use thumbs up/down to improve Nia's results over time.",
		args: {
			action: tool.schema
				.enum(["answer", "source", "interaction"])
				.describe("Type of feedback to submit"),
			answer_id: tool.schema
				.string()
				.optional()
				.describe("Answer ID (required for answer feedback)"),
			source_id: tool.schema
				.string()
				.optional()
				.describe("Source ID (required for source feedback)"),
			interaction_id: tool.schema
				.string()
				.optional()
				.describe("Interaction ID (required for interaction feedback)"),
			feedback_type: tool.schema
				.string()
				.optional()
				.describe("Type of feedback (e.g., 'thumbs_up', 'thumbs_down', 'helpful', 'viewed')"),
			comment: tool.schema
				.string()
				.optional()
				.describe("Optional comment explaining the feedback"),
			metadata: tool.schema
				.string()
				.optional()
				.describe("Optional JSON metadata as a string"),
		},
		async execute(args, context) {
			try {
				if (context.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.feedbackEnabled) {
					return "config_error: nia feedback is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const action = args.action;
				if (!VALID_ACTIONS.includes(action)) {
					return `error: unknown action "${action}". Valid actions: ${VALID_ACTIONS.join(", ")}`;
				}

				const handler = ACTION_HANDLERS[action];
				return await handler(client, args as FeedbackArgs);
			} catch (error) {
				return formatError(error, context.abort.aborted);
			}
		},
	});
}
