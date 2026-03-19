import { tool } from "@opencode-ai/plugin";

export type IndexSourceType = "repository" | "data_source" | "research_paper";

export type IndexClient = {
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T | string>;
};

type IndexClientResolver = IndexClient | (() => IndexClient | undefined);

type IndexResponse = {
  id?: string;
  source_id?: string;
};

const SOURCE_TYPE_SCHEMA = tool.schema.enum(["repository", "data_source", "research_paper"]);
const URL_SCHEMA = tool.schema
  .string()
  .refine((value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }, "Invalid URL");

const PAPER_HOSTS = new Set([
  "arxiv.org",
  "doi.org",
  "openreview.net",
  "papers.nips.cc",
  "aclanthology.org",
  "ieeexplore.ieee.org",
  "dl.acm.org",
]);

export function detectSourceType(url: string): IndexSourceType {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (hostname === "github.com" && parsed.pathname.split("/").filter(Boolean).length >= 2) {
    return "repository";
  }

  if (PAPER_HOSTS.has(hostname) || pathname.endsWith(".pdf")) {
    return "research_paper";
  }

  return "data_source";
}

function resolveClient(clientOrResolver: IndexClientResolver): IndexClient | undefined {
  return typeof clientOrResolver === "function"
    ? (clientOrResolver as () => IndexClient | undefined)()
    : clientOrResolver;
}

function normalizeRepositoryUrl(url: string): string {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);

  if (parsed.hostname.toLowerCase() !== "github.com" || parts.length < 2) {
    return url;
  }

  return `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
}

function buildRequestBody(args: { url: string; source_type?: IndexSourceType; name?: string }) {
  const sourceType = args.source_type ?? detectSourceType(args.url);

  if (sourceType === "repository") {
    return {
      sourceType,
      path: "/repositories",
      body: {
        repository: normalizeRepositoryUrl(args.url),
      },
    };
  }

  if (sourceType === "research_paper") {
    return {
      sourceType,
      path: "/research-papers",
      body: {
        url: args.url,
      },
    };
  }

  return {
    sourceType,
    path: "/data-sources",
    body: {
      url: args.url,
      display_name: args.name?.trim() || new URL(args.url).hostname,
    },
  };
}

function extractSourceId(response: IndexResponse): string | undefined {
  return response.source_id ?? response.id;
}

export function createNiaIndexTool(clientOrResolver: IndexClientResolver) {
  return tool({
    description: "Index a GitHub repository, docs site, or research paper in Nia.",
    args: {
      url: URL_SCHEMA.describe("GitHub repo, docs, or paper URL to index"),
      source_type: SOURCE_TYPE_SCHEMA.optional().describe(
        "Optional source type override: repository, data_source, or research_paper"
      ),
      name: tool.schema.string().trim().min(1).optional().describe("Optional display name for the source"),
    },
    async execute(args, context) {
      const client = resolveClient(clientOrResolver);

      if (!client) {
        return "unauthorized [401]: NIA_API_KEY is not configured";
      }

      const request = buildRequestBody(args);
      const response = await client.post<IndexResponse>(request.path, request.body, context.abort);

      if (typeof response === "string") {
        return response;
      }

      const sourceId = extractSourceId(response);

      if (!sourceId) {
        return "invalid_response: missing source_id in Nia API response";
      }

      return JSON.stringify(
        {
          source_id: sourceId,
          source_type: request.sourceType,
          status: "queued",
          message: "Indexing started. Use nia_manage_resource to check progress.",
        },
        null,
        2
      );
    },
  });
}
