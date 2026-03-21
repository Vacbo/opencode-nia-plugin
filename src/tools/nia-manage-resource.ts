import type { ToolContext } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

import type { NiaClient } from "../api/client.js";
import type { NiaConfig } from "../config.js";
import { createToolErrorFormatter } from "../utils/format.js";

const ABORT_ERROR = "abort_error [nia_manage_resource]: request aborted";

export type NiaManageAction =
	| "list"
	| "status"
	| "rename"
	| "delete"
	| "subscribe"
	| "category_list"
	| "category_create"
	| "category_delete";

export type NiaResourceType =
	| "repository"
	| "data_source"
	| "research_paper"
	| "category";

type AskResult = boolean | undefined;

const ACTION_SCHEMA = tool.schema.enum([
	"list",
	"status",
	"rename",
	"delete",
	"subscribe",
	"category_list",
	"category_create",
	"category_delete",
]);

const RESOURCE_TYPE_SCHEMA = tool.schema.enum([
	"repository",
	"data_source",
	"research_paper",
	"category",
]);

const RESOURCE_PATHS: Record<NiaResourceType, string> = {
	repository: "/repositories",
	data_source: "/data-sources",
	research_paper: "/research-papers",
	category: "/categories",
};

function jsonResult(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function resourcePath(
	resourceType: NiaResourceType,
	resourceId?: string,
): string {
	const basePath = RESOURCE_PATHS[resourceType];
	return resourceId ? `${basePath}/${resourceId}` : basePath;
}

function requireResourceIdentity(args: {
	action: NiaManageAction;
	resource_type?: NiaResourceType;
	resource_id?: string;
}): { resourceType: NiaResourceType; resourceId: string } | string {
	if (!args.resource_type) {
		return `validation_failed [422]: action "${args.action}" requires resource_type`;
	}

	if (!args.resource_id) {
		return `validation_failed [422]: action "${args.action}" requires resource_id`;
	}

	return {
		resourceType: args.resource_type,
		resourceId: args.resource_id,
	};
}

async function requestDeletePermission(
	context: ToolContext,
	resourceType: NiaResourceType,
	resourceId: string,
): Promise<boolean> {
	try {
		const result = (await (
			context.ask as unknown as (input: {
				permission: string;
				patterns: string[];
				always: string[];
				metadata: Record<string, unknown>;
			}) => Promise<AskResult>
		)({
			permission: "delete",
			patterns: [resourcePath(resourceType, resourceId)],
			always: [],
			metadata: {
				action: "delete",
				resourceType,
				resourceId,
				title: "Delete Nia resource?",
				description: `Permanently delete ${resourceType.replace(/_/g, " ")} ${resourceId}.`,
				confirmText: "Delete",
				cancelText: "Cancel",
			},
		})) as AskResult;

		return result !== false;
	} catch {
		return false;
	}
}

export function createNiaManageResourceTool(
	client: NiaClient,
	config: NiaConfig,
) {
	return tool({
		description:
			"List, inspect, rename, subscribe to, or delete Nia resources and categories.",
		args: {
			action: ACTION_SCHEMA.describe(
				"Action to run: list, status, rename, delete, subscribe, category_list, category_create, or category_delete",
			),
			resource_type: RESOURCE_TYPE_SCHEMA.optional().describe(
				"Resource type for status, rename, delete, or subscribe actions",
			),
			resource_id: tool.schema
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("Resource or category identifier"),
			name: tool.schema
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("New name or category name"),
			description: tool.schema
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("Optional category description"),
		},
		async execute(args, context) {
			try {
				if (context.abort.aborted) {
					return ABORT_ERROR;
				}

				if (!config.searchEnabled) {
					return "config_error: nia search is disabled";
				}

				if (!config.apiKey) {
					return "config_error: NIA_API_KEY is not set";
				}

				switch (args.action) {
					case "list": {
						const [repositories, dataSources] = await Promise.all([
							client.get<unknown[]>("/repositories", undefined, context.abort),
							client.get<unknown[]>("/data-sources", undefined, context.abort),
						]);

						return jsonResult({
							repositories,
							data_sources: dataSources,
						});
					}

					case "status": {
						const identity = requireResourceIdentity(args);
						if (typeof identity === "string") return identity;

						const response = await client.get(
							resourcePath(identity.resourceType, identity.resourceId),
							undefined,
							context.abort,
						);
						return typeof response === "string"
							? response
							: jsonResult(response);
					}

					case "rename": {
						const identity = requireResourceIdentity(args);
						if (typeof identity === "string") return identity;
						if (!args.name) {
							return 'validation_failed [422]: action "rename" requires name';
						}

						const response = await client.patch(
							resourcePath(identity.resourceType, identity.resourceId),
							identity.resourceType === "data_source"
								? { name: args.name, display_name: args.name }
								: { name: args.name },
							context.abort,
						);

						return typeof response === "string"
							? response
							: jsonResult(response);
					}

					case "delete": {
						const identity = requireResourceIdentity(args);
						if (typeof identity === "string") return identity;

						const approved = await requestDeletePermission(
							context,
							identity.resourceType,
							identity.resourceId,
						);
						if (!approved) {
							return "Delete cancelled.";
						}

						const response = await client.delete(
							resourcePath(identity.resourceType, identity.resourceId),
							undefined,
							context.abort,
						);
						return typeof response === "string"
							? response
							: jsonResult(response);
					}

					case "subscribe": {
						const identity = requireResourceIdentity(args);
						if (typeof identity === "string") return identity;

						const response = await client.post(
							`${resourcePath(identity.resourceType, identity.resourceId)}/subscribe`,
							undefined,
							context.abort,
						);

						return typeof response === "string"
							? response
							: jsonResult(response);
					}

					case "category_list": {
						const response = await client.get(
							resourcePath("category"),
							undefined,
							context.abort,
						);
						return typeof response === "string"
							? response
							: jsonResult(response);
					}

					case "category_create": {
						if (!args.name) {
							return 'validation_failed [422]: action "category_create" requires name';
						}

						const response = await client.post(
							resourcePath("category"),
							{
								name: args.name,
								...(args.description ? { description: args.description } : {}),
							},
							context.abort,
						);

						return typeof response === "string"
							? response
							: jsonResult(response);
					}

					case "category_delete": {
						if (!args.resource_id) {
							return 'validation_failed [422]: action "category_delete" requires resource_id';
						}

						const approved = await requestDeletePermission(
							context,
							"category",
							args.resource_id,
						);
						if (!approved) {
							return "Delete cancelled.";
						}

						const response = await client.delete(
							resourcePath("category", args.resource_id),
							undefined,
							context.abort,
						);
						return typeof response === "string"
							? response
							: jsonResult(response);
					}
				}
			} catch (error) {
				return formatError(error, context.abort.aborted);
			}
		},
	});
}

const formatError = createToolErrorFormatter("manage_resource");
