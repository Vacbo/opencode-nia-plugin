import type { NiaClient } from "../api/client.js";
import type { SourceListResponse } from "../api/types.js";

export interface ResolvedSource {
  id: string;
  type: "repository" | "data_source";
  endpoint: "repositories" | "data-sources";
}

const SOURCE_TYPE_MAP: Record<
  string,
  { type: "repository" | "data_source"; endpoint: "repositories" | "data-sources" }
> = {
  repository: { type: "repository", endpoint: "repositories" },
  data_source: { type: "data_source", endpoint: "data-sources" },
};

export async function resolveSource(
  client: NiaClient,
  args: { source_id?: string; source_type?: string; identifier?: string },
  signal?: AbortSignal,
): Promise<ResolvedSource | string> {
  if (args.source_id) {
    const mapping = args.source_type
      ? SOURCE_TYPE_MAP[args.source_type]
      : SOURCE_TYPE_MAP.repository;

    if (!mapping) {
      return `validation_error: unknown source_type "${args.source_type}"`;
    }

    return { id: args.source_id, ...mapping };
  }

  if (!args.source_type || !args.identifier) {
    return "validation_error: provide source_id OR both source_type and identifier";
  }

  const mapping = SOURCE_TYPE_MAP[args.source_type];
  if (!mapping) {
    return `validation_error: unknown source_type "${args.source_type}"`;
  }

  const result = await client.get<SourceListResponse>(
    "/sources",
    { type: args.source_type, query: args.identifier, limit: 1 },
    signal,
  );

  if (typeof result === "string") {
    return result;
  }

  if (!result.sources || result.sources.length === 0) {
    return `not_found: no ${args.source_type} matching "${args.identifier}"`;
  }

  return { id: result.sources[0].id, ...mapping };
}
