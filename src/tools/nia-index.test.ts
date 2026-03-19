import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { createNiaIndexTool, type IndexClient } from "./nia-index";

function parseArgs<TArgs extends z.ZodRawShape>(definition: { args: TArgs }, input: unknown): z.infer<z.ZodObject<TArgs>> {
  return z.object(definition.args).parse(input);
}

describe("createNiaIndexTool", () => {
  it("auto-detects GitHub repositories and indexes them without polling", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = {
      post: async <T>(path: string, body?: unknown) => {
        calls.push({ path, body });
        return { source_id: "repo_123", status: "indexing" } as T;
      },
    } satisfies IndexClient;
    const tool = createNiaIndexTool(client);

    const result = await tool.execute(
      parseArgs(tool, { url: "https://github.com/nozomio-labs/nia-opencode" }),
      {} as never
    );

    expect(calls).toEqual([
      {
        path: "/repositories",
        body: { repository: "nozomio-labs/nia-opencode" },
      },
    ]);

    expect(JSON.parse(result)).toEqual({
      source_id: "repo_123",
      source_type: "repository",
      status: "queued",
      message: "Indexing started. Use nia_manage_resource to check progress.",
    });
  });

  it("indexes documentation sources with an optional display name", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = {
      post: async <T>(path: string, body?: unknown) => {
        calls.push({ path, body });
        return { id: "doc_123" } as T;
      },
    } satisfies IndexClient;
    const tool = createNiaIndexTool(client);

    const result = await tool.execute(
      parseArgs(tool, {
        url: "https://docs.trynia.ai/sdk/examples",
        name: "Nia SDK docs",
      }),
      {} as never
    );

    expect(calls).toEqual([
      {
        path: "/data-sources",
        body: {
          url: "https://docs.trynia.ai/sdk/examples",
          display_name: "Nia SDK docs",
        },
      },
    ]);

    expect(JSON.parse(result)).toMatchObject({
      source_id: "doc_123",
      source_type: "data_source",
    });
  });

  it("routes arXiv URLs to research paper indexing", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = {
      post: async <T>(path: string, body?: unknown) => {
        calls.push({ path, body });
        return { source_id: "paper_123" } as T;
      },
    } satisfies IndexClient;
    const tool = createNiaIndexTool(client);

    const result = await tool.execute(
      parseArgs(tool, { url: "https://arxiv.org/abs/2401.01234" }),
      {} as never
    );

    expect(calls).toEqual([
      {
        path: "/research-papers",
        body: { url: "https://arxiv.org/abs/2401.01234" },
      },
    ]);

    expect(JSON.parse(result)).toMatchObject({
      source_id: "paper_123",
      source_type: "research_paper",
    });
  });

  it("returns client error strings unchanged", async () => {
    const client = {
      post: async <T>() => "validation_failed [422]: unsupported url" as T | string,
    } satisfies IndexClient;
    const tool = createNiaIndexTool(client);

    const result = await tool.execute(
      parseArgs(tool, { url: "https://github.com/nozomio-labs/nia-opencode" }),
      {} as never
    );

    expect(result).toBe("validation_failed [422]: unsupported url");
  });
});
