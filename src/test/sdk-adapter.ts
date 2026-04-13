import type { SdkAdapter } from "../api/nia-sdk.js";

export type MockResponse = {
	status: number;
	body?: unknown;
	headers?: HeadersInit;
};

export type MockHandler = (
	url: string,
	init: RequestInit,
) => MockResponse | Response | Promise<MockResponse | Response>;

export type ResponseHandler = (
	url: string,
	init: RequestInit,
) => Response | Promise<Response>;


function createRequestInit(
	method: string,
	body?: unknown,
	apiKey = process.env.NIA_API_KEY,
): RequestInit {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};

	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	return {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	};
}

async function resolveMockResponse(
	responsesOrHandler: MockResponse[] | MockHandler,
	url: string,
	init: RequestInit,
): Promise<MockResponse> {
	if (Array.isArray(responsesOrHandler)) {
		const nextResponse = responsesOrHandler.shift();
		if (!nextResponse) {
			throw new Error(`Unexpected request for ${url}`);
		}

		return nextResponse;
	}

	const response = await responsesOrHandler(url, init);
	if (response instanceof Response) {
		const contentType = response.headers.get("content-type") ?? "";
		const body = contentType.includes("application/json")
			? await response.json()
			: await response.text();
		return {
			status: response.status,
			body,
			headers: Object.fromEntries(response.headers.entries()),
		};
	}

	return response;
}

async function readResponseBody(response: MockResponse): Promise<unknown> {
	if (response.status >= 400) {
		let errorText: string;
		if (typeof response.body === "string") {
			errorText = response.body;
		} else if (
			response.body &&
			typeof response.body === "object" &&
			"message" in response.body &&
			typeof response.body.message === "string"
		) {
			errorText = response.body.message;
		} else {
			errorText = JSON.stringify(response.body);
		}
		throw new Error(`HTTP ${response.status}: ${errorText}`);
	}

	return response.body;
}

export function createMockSdkAdapter(
	responsesOrHandler: MockResponse[] | MockHandler,
	baseUrl = "https://nia.test/v2",
): SdkAdapter {
	const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

	const request = async <T>(
		method: string,
		path: string,
		body?: unknown,
		params?: Record<string, unknown>,
	): Promise<T> => {
		const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
		const url = new URL(normalizedPath, base);
		if (params) {
			for (const [key, value] of Object.entries(params)) {
				if (value !== undefined && value !== null) {
					url.searchParams.append(key, String(value));
				}
			}
		}

		const init = createRequestInit(method, body);
		const response = await resolveMockResponse(responsesOrHandler, url.toString(), init);
		return (await readResponseBody(response)) as T;
	};

	const streamFrom = async function* (
		path: string,
	): AsyncGenerator<Record<string, unknown>> {
		const response = await request<unknown>("GET", path);
		if (Array.isArray(response)) {
			for (const event of response) {
				if (event && typeof event === "object") {
					yield event as Record<string, unknown>;
				}
			}
		}
	};

	return {
		search: {
			universal: (query, options) =>
				request("POST", "/search", {
					query,
					mode: "universal",
					num_results: options?.num_results,
					repositories: options?.repositories,
					data_sources: options?.data_sources,
				}),
			query: (query, options) =>
				request("POST", "/search", {
					query,
					mode: "query",
					num_results: options?.num_results,
				}),
			web: (query, options) =>
				request("POST", "/search", {
					query,
					mode: "web",
					num_results: options?.num_results,
				}),
			deep: (query, options) =>
				request("POST", "/search", {
					query,
					mode: "deep",
					num_results: options?.num_results,
				}),
		},
		sources: {
			create: (body) => request("POST", "/sources", body),
			list: (params) => request("GET", "/sources", undefined, params),
			resolve: (identifier, type) =>
				request("GET", "/sources", undefined, {
					type,
					query: identifier,
					limit: 1,
				}),
			get: (id) => request("GET", `/sources/${id}`),
			update: (id, body) => request("PATCH", `/sources/${id}`, body),
			delete: (id) => request("DELETE", `/sources/${id}`),
		},
		oracle: {
			createJob: (body) => request("POST", "/oracle/jobs", body),
			getJob: (id) => request("GET", `/oracle/jobs/${id}`),
			waitForJob: (id) => request("GET", `/oracle/jobs/${id}`),
			streamJob: (id) => streamFrom(`/oracle/jobs/${id}/stream`),
		},
		tracer: {
			createJob: (body) => request("POST", "/github/tracer", body),
			streamJob: (id) => streamFrom(`/github/tracer/${id}/stream`),
		},
		sandbox: {
			createJob: (body) => request("POST", "/sandbox/search", body),
			getJob: (id) => request("GET", `/sandbox/jobs/${id}`),
			streamJob: (id) => streamFrom(`/sandbox/jobs/${id}/stream`),
		},
		documentAgent: {
			query: (body) => request("POST", "/document/agent", body),
			createJob: (body) => request("POST", "/document/agent/jobs", body),
			getJob: (id) => request("GET", `/document/agent/jobs/${id}`),
			streamJob: (id) => streamFrom(`/document/agent/jobs/${id}/stream`),
			deleteJob: (id) => request("DELETE", `/document/agent/jobs/${id}`),
		},
		contexts: {
			create: (body) => request("POST", "/contexts", body),
			list: (params) => request("GET", "/contexts", undefined, params),
			get: (id) => request("GET", `/contexts/${id}`),
			update: (id, body) => request("PUT", `/contexts/${id}`, body),
			delete: (id) => request("DELETE", `/contexts/${id}`),
			semanticSearch: (params) =>
				request("GET", "/contexts/semantic-search", undefined, params),
		},
		packages: {
			search: (body) => request("POST", "/packages/search", body),
		},
		dependencies: {
			analyze: (body) => request("POST", "/dependencies/analyze", body),
			subscribe: (body) => request("POST", "/dependencies/subscribe", body),
		},
		advisor: {
			ask: (body) => request("POST", "/advisor", body),
		},
		filesystem: {
			read: (sourceId, params) => request("GET", `/fs/${sourceId}/read`, undefined, params),
			write: (sourceId, body) => request("PUT", `/fs/${sourceId}/files`, body),
			grep: (sourceId, body) => request("POST", `/fs/${sourceId}/grep`, body),
			tree: (sourceId, params) => request("GET", `/fs/${sourceId}/tree`, undefined, params),
			mkdir: (sourceId, body) => request("POST", `/fs/${sourceId}/mkdir`, body),
			mv: (sourceId, body) => request("POST", `/fs/${sourceId}/mv`, body),
			rm: (sourceId, body) =>
				request(
					"DELETE",
					`/fs/${sourceId}/files?path=${encodeURIComponent((body as { path: string }).path)}`,
				),
		},
		daemon: {
			createSource: (input) => request("POST", "/daemon/sources", input),
			listSources: () => request("GET", "/daemon/sources"),
			createE2ESession: (input) => request("POST", "/daemon/e2e/sessions", input),
			getE2ESessionStatus: (sessionId) =>
				request("GET", `/daemon/e2e/sessions/${sessionId}`),
			decryptE2EChunks: (sessionId, chunkIds) =>
				request("POST", `/daemon/e2e/sessions/${sessionId}/decrypt`, { chunkIds }),
		},
		get: (path, params) => request("GET", path, undefined, params),
		post: (path, body) => request("POST", path, body),
		put: (path, body) => request("PUT", path, body),
		patch: (path, body) => request("PATCH", path, body),
		delete: (path) => request("DELETE", path),
	};
}

export function asSdkAdapter(partial: Partial<SdkAdapter>): SdkAdapter {
	return partial as SdkAdapter;
}

export function createResponseSdkAdapter(
	handler: ResponseHandler,
	baseUrl = "https://nia.test/v2",
): SdkAdapter {
	return createMockSdkAdapter((url, init) => handler(url, init), baseUrl);
}

export function createMatchedResponseHandler(
	handlers: Array<{ match: string; response: unknown; status?: number }>,
): ResponseHandler {
	return async (url: string) => {
		for (const handler of handlers) {
			if (url.includes(handler.match)) {
				return new Response(
					handler.response === undefined ? null : JSON.stringify(handler.response),
					{
						status: handler.status ?? 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
		}

		return new Response(JSON.stringify({ message: "not found" }), {
			status: 404,
			headers: { "content-type": "application/json" },
		});
	};
}
