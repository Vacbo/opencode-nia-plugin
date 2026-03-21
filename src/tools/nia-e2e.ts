import { type ToolContext, tool } from "@opencode-ai/plugin";

import type { NiaClient } from "../api/client.js";
import type { E2ESession } from "../api/types.js";
import type { NiaConfig } from "../config.js";
import { createToolErrorFormatter } from "../utils/format.js";

type E2EAction = "create_session" | "get_session" | "purge" | "sync";

const VALID_ACTIONS: readonly E2EAction[] = [
	"create_session",
	"get_session",
	"purge",
	"sync",
];

const ABORT_ERROR = "abort_error [nia_e2e]: request aborted";
const formatError = createToolErrorFormatter("e2e");
type AllowedOperation = E2ESession["allowed_operations"][number];

interface E2EArgs {
	action: E2EAction;
	local_folder_id?: string;
	ttl_seconds?: number;
	max_chunks?: number;
	allowed_operations?: AllowedOperation[];
	session_id?: string;
	source_id?: string;
}

type PermissionContext = ToolContext & {
	ask: (input: {
		permission: string;
		patterns: string[];
		always?: string[];
		metadata?: Record<string, string>;
	}) => Promise<void>;
};

const DEFAULT_ALLOWED_OPERATIONS: AllowedOperation[] = ["search", "read"];

function formatSession(session: E2ESession, title: string): string {
	return [
		title,
		"",
		`Session ID: ${session.id}`,
		`Local folder: ${session.local_folder_id}`,
		`Expires at: ${session.expires_at}`,
		`Max chunks: ${session.max_chunks}`,
		`Allowed operations: ${session.allowed_operations.join(", ")}`,
	].join("\n");
}

function formatObjectResult(title: string, value: unknown): string {
	if (value === undefined) {
		return title;
	}

	if (typeof value === "string") {
		return `${title}\n\n${value}`;
	}

	return `${title}\n\n${JSON.stringify(value, null, 2)}`;
}

async function handleCreateSession(
	client: NiaClient,
	args: E2EArgs,
	context: ToolContext,
): Promise<string> {
	if (!args.local_folder_id?.trim()) {
		return "error: local_folder_id is required for create_session action";
	}

	const result = await client.post<E2ESession>(
		"/daemon/e2e/sessions",
		{
			local_folder_id: args.local_folder_id,
			ttl_seconds: args.ttl_seconds ?? 300,
			max_chunks: args.max_chunks ?? 50,
			allowed_operations: args.allowed_operations ?? DEFAULT_ALLOWED_OPERATIONS,
		},
		context.abort,
	);

	if (typeof result === "string") {
		return result;
	}

	return formatSession(result, "E2E session created successfully.");
}

async function handleGetSession(
	client: NiaClient,
	args: E2EArgs,
	context: ToolContext,
): Promise<string> {
	if (!args.session_id?.trim()) {
		return "error: session_id is required for get_session action";
	}

	const result = await client.get<E2ESession>(
		`/daemon/e2e/sessions/${args.session_id}`,
		undefined,
		context.abort,
	);
	if (typeof result === "string") {
		return result;
	}

	return formatSession(result, "E2E session details.");
}

async function handlePurge(
	client: NiaClient,
	args: E2EArgs,
	context: PermissionContext,
): Promise<string> {
	if (!args.source_id?.trim()) {
		return "error: source_id is required for purge action";
	}

	let permission: unknown;
	try {
		permission = await context.ask({
			permission: `Purge E2E data for source ${args.source_id}`,
			patterns: [`nia:e2e:purge:${args.source_id}`],
			always: ["nia:e2e:purge"],
			metadata: { sourceId: args.source_id },
		});
	} catch {
		return "error: permission denied";
	}

	if (permission === false) {
		return "error: permission denied";
	}

	const result = await client.delete<Record<string, unknown>>(
		`/daemon/e2e/sources/${args.source_id}/data`,
		undefined,
		context.abort,
	);
	if (typeof result === "string") {
		return result;
	}

	return formatObjectResult(
		`E2E data purged successfully for source ${args.source_id}.`,
		result,
	);
}

async function handleSync(
	client: NiaClient,
	args: E2EArgs,
	context: ToolContext,
): Promise<string> {
	if (!args.local_folder_id?.trim()) {
		return "error: local_folder_id is required for sync action";
	}

	const result = await client.post<Record<string, unknown>>(
		"/daemon/e2e/sync",
		{ local_folder_id: args.local_folder_id },
		context.abort,
	);
	if (typeof result === "string") {
		return result;
	}

	return formatObjectResult(
		`E2E sync requested for local folder ${args.local_folder_id}.`,
		result,
	);
}

const ACTION_HANDLERS: Record<
	E2EAction,
	(client: NiaClient, args: E2EArgs, context: ToolContext) => Promise<string>
> = {
	create_session: handleCreateSession,
	get_session: handleGetSession,
	purge: (client, args, context) =>
		handlePurge(client, args, context as PermissionContext),
	sync: handleSync,
};

export function createNiaE2ETool(client: NiaClient, config: NiaConfig) {
	if (!config.e2eEnabled) {
		return null;
	}

	return tool({
		description:
			"Manage Nia E2E daemon operations for encrypted local folders. Create and inspect sessions, request syncs, and purge encrypted source data with explicit permission.",
		args: {
			action: tool.schema
				.enum(["create_session", "get_session", "purge", "sync"])
				.describe("Action to perform"),
			local_folder_id: tool.schema
				.string()
				.optional()
				.describe("Local folder ID (required for create_session and sync)"),
			ttl_seconds: tool.schema
				.number()
				.optional()
				.describe("Session TTL in seconds for create_session (default: 300)"),
			max_chunks: tool.schema
				.number()
				.optional()
				.describe("Maximum chunks for create_session (default: 50)"),
			allowed_operations: tool.schema
				.array(tool.schema.enum(["search", "read"]))
				.optional()
				.describe(
					"Allowed session operations for create_session (default: [search, read])",
				),
			session_id: tool.schema
				.string()
				.optional()
				.describe("Session ID (required for get_session)"),
			source_id: tool.schema
				.string()
				.optional()
				.describe("Source ID (required for purge)"),
		},
		async execute(args, context) {
			try {
				if (context.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				const action = args.action as E2EAction;
				if (!VALID_ACTIONS.includes(action)) {
					return `error: unknown action "${args.action}". Valid actions: ${VALID_ACTIONS.join(", ")}`;
				}

				const handler = ACTION_HANDLERS[action];
				if (!handler) {
					return `error: unknown action "${args.action}". Valid actions: ${VALID_ACTIONS.join(", ")}`;
				}

				return handler(client, args as E2EArgs, context);
			} catch (error) {
				return formatError(error, context.abort.aborted);
			}
		},
	});
}
