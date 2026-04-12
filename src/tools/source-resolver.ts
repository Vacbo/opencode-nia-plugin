import type { NiaClient } from "../api/client.js";
import type { SourceListResponse } from "../api/types.js";

export interface ResolvedSource {
  id: string;
  type: string;
}

const VALID_SOURCE_TYPES = new Set([
  "repository",
  "data_source",
  "documentation",
  "research_paper",
  "huggingface_dataset",
  "local_folder",
  "slack",
  "google_drive",
]);

// Map legacy plugin source_type values to API-compatible values
const SOURCE_TYPE_API_MAP: Record<string, string> = {
  data_source: "documentation",
};

function mapSourceTypeToApi(sourceType: string): string {
  return SOURCE_TYPE_API_MAP[sourceType] || sourceType;
}

export async function resolveSource(
  client: NiaClient,
  args: { source_id?: string; source_type?: string; identifier?: string },
  signal?: AbortSignal,
): Promise<ResolvedSource | string> {
  if (args.source_id) {
    if (!args.source_type) {
      return "validation_error: source_type is required when source_id is provided";
    }

    if (!VALID_SOURCE_TYPES.has(args.source_type)) {
      return `validation_error: unknown source_type "${args.source_type}"`;
    }

    return { id: args.source_id, type: args.source_type };
  }

  if (!args.source_type || !args.identifier) {
    return "validation_error: provide source_id OR both source_type and identifier";
  }

  if (!VALID_SOURCE_TYPES.has(args.source_type)) {
    return `validation_error: unknown source_type "${args.source_type}"`;
  }

  const result = await client.get<SourceListResponse>(
    "/sources",
    { type: mapSourceTypeToApi(args.source_type), query: args.identifier, limit: 1 },
    signal,
  );

  if (typeof result === "string") {
    return result;
  }

  if (!result.sources || result.sources.length === 0) {
    return `not_found: no ${args.source_type} matching "${args.identifier}"`;
  }

  return { id: result.sources[0].id, type: args.source_type };
}
