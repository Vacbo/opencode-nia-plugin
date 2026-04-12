import { NiaSDK } from "nia-ai-ts";
import type { NiaConfig } from "../config.js";

export type { NiaSDK };

export interface SdkAdapter {
	search: {
		universal: (query: string, options?: { num_results?: number; repositories?: string[]; data_sources?: string[] }) => Promise<unknown>;
		query: (query: string, options?: { num_results?: number }) => Promise<unknown>;
		web: (query: string, options?: { num_results?: number }) => Promise<unknown>;
		deep: (query: string, options?: { num_results?: number }) => Promise<unknown>;
	};
	sources: {
		create: (body: unknown) => Promise<unknown>;
		list: (params?: { type?: string; query?: string; limit?: number }) => Promise<unknown>;
		resolve: (identifier: string, type?: string) => Promise<unknown>;
	};
	oracle: {
		createJob: (body: unknown) => Promise<unknown>;
		getJob: (id: string) => Promise<unknown>;
		waitForJob: (id: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
		streamJob: (id: string) => AsyncGenerator<Record<string, unknown>>;
	};
	daemon: {
		createSource: (input: unknown) => Promise<unknown>;
		listSources: () => Promise<unknown[]>;
		createE2ESession: (input: unknown) => Promise<unknown>;
		getE2ESessionStatus: (sessionId: string) => Promise<unknown>;
		decryptE2EChunks: (sessionId: string, chunkIds: string[]) => Promise<unknown>;
	};
}

export function createSdkAdapter(config: NiaConfig): SdkAdapter {
	const sdk = new NiaSDK({
		apiKey: config.apiKey ?? "",
		baseUrl: config.apiUrl,
	});

	return {
		search: {
			universal: async (query, options) => {
				const response = await sdk.search.universal({
					query,
					top_k: options?.num_results ?? 10,
					repositories: options?.repositories,
					data_sources: options?.data_sources,
				});
				return response;
			},
			query: async (query, options) => {
				const response = await sdk.search.query({
					query,
					top_k: options?.num_results ?? 10,
				});
				return response;
			},
			web: async (query, options) => {
				const response = await sdk.search.web({
					query,
					top_k: options?.num_results ?? 10,
				});
				return response;
			},
			deep: async (query, options) => {
				const response = await sdk.search.deep({
					query,
					top_k: options?.num_results ?? 10,
				});
				return response;
			},
		},
		sources: {
			create: async (body) => {
				const response = await sdk.sources.create(body as Record<string, unknown>);
				return response;
			},
			list: async (params) => {
				const response = await sdk.sources.list({
					type: params?.type as "repository" | "documentation" | "research_paper" | "huggingface_dataset" | "local_folder" | null | undefined,
					query: params?.query,
					limit: params?.limit,
				});
				return response;
			},
			resolve: async (identifier, type) => {
				const response = await sdk.sources.resolve(
					identifier,
					type as "repository" | "documentation" | "research_paper" | "huggingface_dataset" | "local_folder" | null | undefined,
				);
				return response;
			},
		},
		oracle: {
			createJob: async (body) => {
				const response = await sdk.oracle.createJob(body as Record<string, unknown>);
				return response;
			},
			getJob: async (id) => {
				const response = await sdk.oracle.getJob(id);
				return response;
			},
			waitForJob: async (id, timeoutMs) => {
				const response = await sdk.oracle.waitForJob(id, timeoutMs);
				return response;
			},
			streamJob: async function* (id) {
				const stream = sdk.oracle.streamJob(id);
				for await (const event of stream) {
					yield event;
				}
			},
		},
		daemon: {
			createSource: async (input) => {
				const response = await sdk.daemon.createSource(input as { path: string; displayName?: string });
				return response;
			},
			listSources: async () => {
				const response = await sdk.daemon.listSources();
				return response;
			},
			createE2ESession: async (input) => {
				const response = await sdk.daemon.createE2ESession(input as { localFolderId: string });
				return response;
			},
			getE2ESessionStatus: async (sessionId) => {
				const response = await sdk.daemon.getE2ESessionStatus(sessionId);
				return response;
			},
			decryptE2EChunks: async (sessionId, chunkIds) => {
				const response = await sdk.daemon.decryptE2EChunks(sessionId, chunkIds);
				return response;
			},
		},
	};
}
