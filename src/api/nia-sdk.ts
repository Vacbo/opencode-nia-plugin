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
		get: (id: string) => Promise<unknown>;
		update: (id: string, body: unknown) => Promise<unknown>;
		delete: (id: string) => Promise<unknown>;
	};
	oracle: {
		createJob: (body: unknown) => Promise<unknown>;
		getJob: (id: string) => Promise<unknown>;
		waitForJob: (id: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
		streamJob: (id: string) => AsyncGenerator<Record<string, unknown>>;
	};
	tracer: {
		createJob: (body: unknown) => Promise<unknown>;
		streamJob: (id: string) => AsyncGenerator<Record<string, unknown>>;
	};
	contexts: {
		create: (body: unknown) => Promise<unknown>;
		list: (params?: { limit?: number; offset?: number; tags?: string }) => Promise<unknown>;
		get: (id: string) => Promise<unknown>;
		update: (id: string, body: unknown) => Promise<unknown>;
		delete: (id: string) => Promise<unknown>;
		semanticSearch: (params: { q: string; limit?: number; tags?: string }) => Promise<unknown>;
	};
	packages: {
		search: (body: unknown) => Promise<unknown>;
	};
	dependencies: {
		analyze: (body: unknown) => Promise<unknown>;
		subscribe: (body: unknown) => Promise<unknown>;
	};
	advisor: {
		ask: (body: unknown) => Promise<unknown>;
	};
	filesystem: {
		read: (sourceId: string, params: { path: string; line_start?: number; line_end?: number }, abort?: AbortSignal) => Promise<unknown>;
		write: (sourceId: string, body: unknown, abort?: AbortSignal) => Promise<unknown>;
		grep: (sourceId: string, body: unknown, abort?: AbortSignal) => Promise<unknown>;
		tree: (sourceId: string, params?: { path?: string; max_depth?: number }, abort?: AbortSignal) => Promise<unknown>;
		mkdir: (sourceId: string, body: unknown, abort?: AbortSignal) => Promise<unknown>;
		mv: (sourceId: string, body: unknown, abort?: AbortSignal) => Promise<unknown>;
		rm: (sourceId: string, body: unknown, abort?: AbortSignal) => Promise<unknown>;
	};
	daemon: {
		createSource: (input: unknown) => Promise<unknown>;
		listSources: () => Promise<unknown[]>;
		createE2ESession: (input: unknown) => Promise<unknown>;
		getE2ESessionStatus: (sessionId: string) => Promise<unknown>;
		decryptE2EChunks: (sessionId: string, chunkIds: string[]) => Promise<unknown>;
	};
	// Low-level HTTP methods for endpoints not covered by SDK
	get: <T>(path: string, params?: Record<string, unknown>) => Promise<T>;
	post: <T>(path: string, body?: unknown) => Promise<T>;
	put: <T>(path: string, body?: unknown) => Promise<T>;
	patch: <T>(path: string, body?: unknown) => Promise<T>;
	delete: <T>(path: string) => Promise<T>;
}

export function createSdkAdapter(config: NiaConfig): SdkAdapter {
	const sdk = new NiaSDK({
		apiKey: config.apiKey ?? "",
		baseUrl: config.apiUrl,
	});

	// Low-level HTTP request helper
	const request = async <T>(method: string, path: string, body?: unknown, params?: Record<string, unknown>, abort?: AbortSignal): Promise<T> => {
		const url = new URL(path, config.apiUrl);
		if (params) {
			Object.entries(params).forEach(([key, value]) => {
				if (value !== undefined && value !== null) {
					url.searchParams.append(key, String(value));
				}
			});
		}
		
		const response = await fetch(url.toString(), {
			method,
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${config.apiKey}`,
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: abort,
		});
		
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`HTTP ${response.status}: ${errorText}`);
		}
		
		return response.json() as Promise<T>;
	};

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
			get: async (id) => request("GET", `/sources/${id}`),
			update: async (id, body) => request("PATCH", `/sources/${id}`, body),
			delete: async (id) => request("DELETE", `/sources/${id}`),
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
		tracer: {
			createJob: async (body) => request("POST", "/github/tracer", body),
			streamJob: async function* (id) {
				const response = await fetch(`${config.apiUrl}/github/tracer/${id}/stream`, {
					headers: { "Authorization": `Bearer ${config.apiKey}` },
				});
				const reader = response.body?.getReader();
				if (!reader) return;
				
				const decoder = new TextDecoder();
				let buffer = "";
				
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					
					for (const line of lines) {
						if (line.startsWith("data: ")) {
							try {
								const data = JSON.parse(line.slice(6));
								yield data;
							} catch {
								// Skip invalid JSON
							}
						}
					}
				}
			},
		},
		contexts: {
			create: async (body) => request("POST", "/contexts", body),
			list: async (params) => request("GET", "/contexts", undefined, params),
			get: async (id) => request("GET", `/contexts/${id}`),
			update: async (id, body) => request("PUT", `/contexts/${id}`, body),
			delete: async (id) => request("DELETE", `/contexts/${id}`),
			semanticSearch: async (params) => request("GET", "/contexts/semantic-search", undefined, params),
		},
		packages: {
			search: async (body) => request("POST", "/packages/search", body),
		},
		dependencies: {
			analyze: async (body) => request("POST", "/dependencies/analyze", body),
			subscribe: async (body) => request("POST", "/dependencies/subscribe", body),
		},
		advisor: {
			ask: async (body) => request("POST", "/advisor", body),
		},
		filesystem: {
			read: async (sourceId, params, abort) => request("GET", `/fs/${sourceId}/read`, undefined, params, abort),
			write: async (sourceId, body, abort) => request("POST", `/fs/${sourceId}/write`, body, undefined, abort),
			grep: async (sourceId, body, abort) => request("POST", `/fs/${sourceId}/grep`, body, undefined, abort),
			tree: async (sourceId, params, abort) => request("GET", `/fs/${sourceId}/tree`, undefined, params, abort),
			mkdir: async (sourceId, body, abort) => request("POST", `/fs/${sourceId}/mkdir`, body, undefined, abort),
			mv: async (sourceId, body, abort) => request("POST", `/fs/${sourceId}/mv`, body, undefined, abort),
			rm: async (sourceId, body, abort) => request("POST", `/fs/${sourceId}/rm`, body, undefined, abort),
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
		// Low-level HTTP methods
		get: async <T>(path: string, params?: Record<string, unknown>) => request<T>("GET", path, undefined, params),
		post: async <T>(path: string, body?: unknown) => request<T>("POST", path, body),
		put: async <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
		patch: async <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
		delete: async <T>(path: string) => request<T>("DELETE", path),
	};
}
