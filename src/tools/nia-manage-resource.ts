import type { ToolContext } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

import type { SdkAdapter } from "../api/nia-sdk.js";
import type { NiaConfig } from "../config.js";
import { createToolErrorFormatter } from "../utils/format.js";

const ABORT_ERROR = "abort_error [nia_manage_resource]: request aborted";

export type NiaManageAction =
	| "list"
	| "status"
	| "rename"
	| "delete"
	| "bulk_delete"
	| "subscribe"
	| "category_list"
	| "category_create"
	| "category_delete"
	| "annotation_create"
	| "annotation_list"
	| "annotation_delete";

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
	"bulk_delete",
	"subscribe",
	"category_list",
	"category_create",
	"category_delete",
	"annotation_create",
	"annotation_list",
	"annotation_delete",
]);

const RESOURCE_TYPE_SCHEMA = tool.schema.enum([
	"repository",
	"data_source",
	"research_paper",
	"category",
]);

const RESOURCE_PATHS: Record<NiaResourceType, string> = {
	repository: "/sources",
	data_source: "/sources",
	research_paper: "/sources",
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

async function requestBulkDeletePermission(
	context: ToolContext,
	resourceIds: string[],
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
			patterns: resourceIds.map((id) => `/sources/${id}`),
			always: [],
			metadata: {
				action: "bulk_delete",
				resourceIds,
				title: "Bulk delete Nia resources?",
				description: `Permanently delete ${resourceIds.length} source(s): ${resourceIds.join(", ")}.`,
				confirmText: "Delete All",
				cancelText: "Cancel",
			},
		})) as AskResult;

		return result !== false;
	} catch {
		return false;
	}
}

export function createNiaManageResourceTool(
	client: SdkAdapter,
	config: NiaConfig,
) {
	return tool({
		description:
			"List, inspect, rename, subscribe to, delete, or bulk delete Nia resources and categories.",
		args: {
			action: ACTION_SCHEMA.describe(
				"Action to run: list, status, rename, delete, bulk_delete, subscribe, category_list, category_create, category_delete, annotation_create, annotation_list, or annotation_delete",
			),
			resource_type: RESOURCE_TYPE_SCHEMA.optional().describe(
				"Resource type for status, rename, delete, subscribe, or annotation actions",
			),
			resource_id: tool.schema
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("Resource or category identifier"),
			resource_ids: tool.schema
				.array(tool.schema.string().trim().min(1))
				.optional()
				.describe("Array of resource IDs for bulk_delete action"),
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
			content: tool.schema
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("Annotation content for annotation_create action"),
			annotation_id: tool.schema
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("Annotation ID for annotation_delete action"),
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

			if (args.action === "bulk_delete" && !config.bulkDeleteEnabled) {
				return "config_error: bulk delete is disabled";
			}

			switch (args.action) {
			case "list": {
				const [repositories, dataSources] = await Promise.all([
					client.sources.list({ type: "repository" }),
					client.sources.list({ type: "documentation" }),
				]);

				return jsonResult({
					repositories,
					data_sources: dataSources,
				});
			}

				case "status": {
					const identity = requireResourceIdentity(args);
					if (typeof identity === "string") return identity;

					const response =
						identity.resourceType === "category"
							? await client.get(resourcePath(identity.resourceType, identity.resourceId))
							: await client.sources.get(identity.resourceId);
					return jsonResult(response);
				}

				case "rename": {
					const identity = requireResourceIdentity(args);
					if (typeof identity === "string") return identity;
					if (!args.name) {
						return 'validation_failed [422]: action "rename" requires name';
					}

					const body = identity.resourceType === "data_source"
						? { name: args.name, display_name: args.name }
						: { name: args.name };

					const response =
						identity.resourceType === "category"
							? await client.patch(resourcePath(identity.resourceType, identity.resourceId), body)
							: await client.sources.update(identity.resourceId, body);

					return jsonResult(response);
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

				const response =
					identity.resourceType === "category"
						? await client.delete(resourcePath(identity.resourceType, identity.resourceId))
						: await client.sources.delete(identity.resourceId);
				return jsonResult(response);
			}

			case "bulk_delete": {
				if (!args.resource_ids || args.resource_ids.length === 0) {
					return 'validation_failed [422]: action "bulk_delete" requires resource_ids array with at least one ID';
				}

				const approved = await requestBulkDeletePermission(context, args.resource_ids);
				if (!approved) {
					return "Bulk delete cancelled.";
				}

				const response = await client.post("/sources/bulk-delete", {
					ids: args.resource_ids,
				});
				return jsonResult(response);
			}

			case "subscribe": {
					const identity = requireResourceIdentity(args);
					if (typeof identity === "string") return identity;

					// The unified Nia API no longer supports per-source subscription
					return "deprecated: the unified Nia API no longer supports per-source subscription. Use category organization or the dependencies endpoints instead.";
				}

				case "category_list": {
					const response = await client.get("/categories");
					return jsonResult(response);
				}

				case "category_create": {
					if (!args.name) {
						return 'validation_failed [422]: action "category_create" requires name';
					}

					const body = {
						name: args.name,
						...(args.description ? { description: args.description } : {}),
					};

					const response = await client.post("/categories", body);

					return jsonResult(response);
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

					const response = await client.delete(`/categories/${args.resource_id}`);
					return jsonResult(response);
				}

				case "annotation_create": {
					const identity = requireResourceIdentity(args);
					if (typeof identity === "string") return identity;
					if (!args.content) {
						return 'validation_failed [422]: action "annotation_create" requires content';
					}

					const response = await client.post(
						`/sources/${identity.resourceId}/annotations`,
						{ content: args.content },
					);
					return jsonResult(response);
				}

				case "annotation_list": {
					const identity = requireResourceIdentity(args);
					if (typeof identity === "string") return identity;

					const response = await client.get(`/sources/${identity.resourceId}/annotations`);
					return jsonResult(response);
				}

				case "annotation_delete": {
					const identity = requireResourceIdentity(args);
					if (typeof identity === "string") return identity;
					if (!args.annotation_id) {
						return 'validation_failed [422]: action "annotation_delete" requires annotation_id';
					}

					const response = await client.delete(
						`/sources/${identity.resourceId}/annotations/${args.annotation_id}`,
					);
					return jsonResult(response);
				}
				}
			} catch (error) {
				return formatError(error, context.abort.aborted);
			}
		},
	});
}

const formatError = createToolErrorFormatter("manage_resource");
