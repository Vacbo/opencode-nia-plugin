import type { SSEEvent } from "./types";

export type FetchFn = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

type QueryValue =
	| string
	| number
	| boolean
	| Array<string | number | boolean>
	| null
	| undefined;
type QueryParams = Record<string, QueryValue>;

interface NiaClientOptions {
	apiKey: string;
	baseUrl?: string;
	fetchFn?: FetchFn;
	timeout?: number;
}

const DEFAULT_BASE_URL = "https://apigcp.trynia.ai/v2";
const DEFAULT_TIMEOUT_MS = 30_000;
const LONG_TIMEOUT_MS = 120_000;
const INITIAL_BACKOFF_MS = 100;
const MAX_RETRIES = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);
const ERROR_CODES: Record<number, string> = {
	401: "unauthorized",
	403: "forbidden",
	404: "not_found",
	422: "validation_failed",
	429: "rate_limited",
	500: "server_error",
	503: "service_unavailable",
};

const defaultFetch: FetchFn = (input, init) => {
	if (typeof globalThis.fetch !== "function") {
		return Promise.reject(new Error("Fetch implementation unavailable"));
	}

	return globalThis.fetch(input, init);
};

export class NiaClient {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly fetchFn: FetchFn;
	private readonly timeout: number;

	constructor({ apiKey, baseUrl, fetchFn, timeout }: NiaClientOptions) {
		this.apiKey = apiKey;
		this.baseUrl = (
			baseUrl ??
			process.env.NIA_API_URL ??
			DEFAULT_BASE_URL
		).replace(/\/+$/, "");
		this.fetchFn = fetchFn ?? defaultFetch;
		this.timeout = timeout ?? DEFAULT_TIMEOUT_MS;
	}

	get<T>(
		path: string,
		params?: QueryParams,
		signal?: AbortSignal,
		timeout?: number,
	): Promise<T | string> {
		return this.request<T>("GET", path, params, signal, timeout);
	}

	post<T>(
		path: string,
		body?: unknown,
		signal?: AbortSignal,
		timeout?: number,
	): Promise<T | string> {
		return this.request<T>("POST", path, body, signal, timeout);
	}

	patch<T>(
		path: string,
		body?: unknown,
		signal?: AbortSignal,
		timeout?: number,
	): Promise<T | string> {
		return this.request<T>("PATCH", path, body, signal, timeout);
	}

	delete<T>(
		path: string,
		body?: unknown,
		signal?: AbortSignal,
		timeout?: number,
	): Promise<T | string> {
		return this.request<T>("DELETE", path, body, signal, timeout);
	}

	async *stream(
		path: string,
		params?: QueryParams,
		signal?: AbortSignal,
	): AsyncGenerator<SSEEvent, void, unknown> {
		if (signal?.aborted) {
			return;
		}

		const controller = new AbortController();
		const onAbort = () => controller.abort(signal?.reason);

		if (signal) {
			signal.addEventListener("abort", onAbort, { once: true });
		}

		try {
			const response = await this.fetchFn(this.buildUrl(path, params), {
				method: "GET",
				headers: {
					Accept: "text/event-stream",
					Authorization: `Bearer ${this.apiKey}`,
				},
				signal: controller.signal,
			});

			if (!response.ok) {
				const message = await this.parseErrorMessage(response.clone());
				yield { type: "error", error: this.formatApiError(response, message) };
				return;
			}

			if (!response.body) {
				yield { type: "error", error: "stream_error: response body is null" };
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let eventType: SSEEvent["type"] = "content";

			try {
				while (true) {
					if (signal?.aborted || controller.signal.aborted) {
						yield { type: "error", error: "abort_error: stream cancelled" };
						break;
					}

					const { done, value } = await reader.read();

					if (done) {
						break;
					}

					buffer += decoder.decode(value, { stream: true });

					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";

					for (const line of lines) {
						if (line.startsWith("event:")) {
							const typeStr = line.slice(6).trim();
							if (
								typeStr === "thinking" ||
								typeStr === "searching" ||
								typeStr === "reading" ||
								typeStr === "analyzing" ||
								typeStr === "content" ||
								typeStr === "done" ||
								typeStr === "error"
							) {
								eventType = typeStr;
							}
						} else if (line.startsWith("data:")) {
							const data = line.slice(5).trim();
							if (data) {
								yield { type: eventType, data, content: data };
							}
						}
					}
				}

				if (buffer.trim()) {
					const line = buffer.trim();
					if (line.startsWith("data:")) {
						const data = line.slice(5).trim();
						if (data) {
							yield { type: eventType, data, content: data };
						}
					}
				}
			} finally {
				reader.releaseLock();
			}
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
	}

	private async request<T>(
		method: string,
		path: string,
		payload?: unknown,
		signal?: AbortSignal,
		timeout?: number,
	): Promise<T | string> {
		if (signal?.aborted) {
			return "abort_error [client]: request aborted";
		}

		const controller = new AbortController();
		const onAbort = () => controller.abort(signal?.reason);
		let didTimeout = false;
		const timeoutMs = this.resolveTimeout(path, timeout);

		if (signal) {
			signal.addEventListener("abort", onAbort, { once: true });
		}

		const timeoutId = setTimeout(() => {
			didTimeout = true;
			controller.abort(
				new DOMException(
					`Request timed out after ${timeoutMs}ms`,
					"TimeoutError",
				),
			);
		}, timeoutMs);

		try {
			let _lastTransientNetworkError: unknown;

			for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
				try {
					const response = await this.fetchFn(
						this.buildUrl(
							path,
							method === "GET" ? (payload as QueryParams) : undefined,
						),
						{
							method,
							headers: this.buildHeaders(method, payload),
							body:
								method === "GET" || payload === undefined
									? undefined
									: JSON.stringify(payload),
							signal: controller.signal,
						},
					);

					if (response.ok) {
						return await this.parseSuccess<T>(response.clone());
					}

					const message = await this.parseErrorMessage(response.clone());
					if (
						RETRYABLE_STATUS_CODES.has(response.status) &&
						attempt < MAX_RETRIES
					) {
						await this.sleep(
							this.resolveRetryDelay(
								attempt,
								response.headers.get("Retry-After"),
								response.status,
							),
							controller.signal,
						);
						continue;
					}

					return this.formatApiError(response, message);
				} catch (error) {
					if (didTimeout) {
						return `timeout_error [timeout=${timeoutMs}ms]: request exceeded timeout`;
					}

					if (
						this.isAbortError(error) ||
						controller.signal.aborted ||
						signal?.aborted
					) {
						return "abort_error [client]: request aborted";
					}

					if (this.isTransientNetworkError(error)) {
						_lastTransientNetworkError = error;

						if (attempt < MAX_RETRIES) {
							const backoff = this.resolveRetryDelay(attempt, null, 0);

							try {
								await this.sleep(backoff, controller.signal);
							} catch (backoffError) {
								if (didTimeout) {
									return `timeout_error [timeout=${timeoutMs}ms]: request exceeded timeout`;
								}

								if (
									this.isAbortError(backoffError) ||
									controller.signal.aborted ||
									signal?.aborted
								) {
									return "abort_error [client]: request aborted";
								}

								return `network_error: ${this.stringifyUnknown(backoffError)}`;
							}

							continue;
						}

						break;
					}

					return `network_error: ${this.stringifyUnknown(error)}`;
				}
			}

			return "network_error: request retries exhausted";
		} finally {
			clearTimeout(timeoutId);
			signal?.removeEventListener("abort", onAbort);
		}
	}

	private buildUrl(path: string, params?: QueryParams): string {
		const url = new URL(path.replace(/^\/+/, ""), `${this.baseUrl}/`);

		if (params) {
			for (const [key, value] of Object.entries(params)) {
				if (value === undefined || value === null) continue;
				const values = Array.isArray(value) ? value : [value];
				for (const item of values) {
					url.searchParams.append(key, String(item));
				}
			}
		}

		return url.toString();
	}

	private buildHeaders(
		method: string,
		payload?: unknown,
	): Record<string, string> {
		return {
			Accept: "application/json",
			Authorization: `Bearer ${this.apiKey}`,
			...(method === "GET" || payload === undefined
				? {}
				: { "Content-Type": "application/json" }),
		};
	}

	private resolveTimeout(path: string, timeout?: number): number {
		if (timeout !== undefined) {
			return timeout;
		}

		if (/(^|\/)(oracle|tracer|universal)(\/|$)/.test(path)) {
			return Math.max(this.timeout, LONG_TIMEOUT_MS);
		}

		return this.timeout;
	}

	private resolveRetryDelay(
		attempt: number,
		retryAfter: string | null,
		status: number,
	): number {
		if (status === 429 && retryAfter) {
			const parsed = Number.parseFloat(retryAfter);
			if (Number.isFinite(parsed) && parsed >= 0) {
				return parsed * 1000;
			}

			const retryAt = Date.parse(retryAfter);
			if (!Number.isNaN(retryAt)) {
				return Math.max(0, retryAt - Date.now());
			}
		}

		return INITIAL_BACKOFF_MS * 2 ** attempt;
	}

	private async parseSuccess<T>(response: Response): Promise<T> {
		const text = await response.text();
		if (!text) {
			return undefined as T;
		}

		try {
			return JSON.parse(text) as T;
		} catch {
			return text as T;
		}
	}

	private async parseErrorMessage(response: Response): Promise<string> {
		const text = await response.text();
		if (!text) {
			return response.statusText || "Request failed";
		}

		try {
			const parsed = JSON.parse(text) as Record<string, unknown>;
			const pieces = [parsed.error, parsed.message, parsed.details]
				.filter((value) => value !== undefined)
				.map((value) =>
					typeof value === "string" ? value : JSON.stringify(value),
				);

			return pieces.length > 0 ? pieces.join(" | ") : text;
		} catch {
			return text;
		}
	}

	private formatApiError(response: Response, message: string): string {
		const code = ERROR_CODES[response.status] ?? `http_${response.status}`;
		const rateLimit = [
			response.headers.get("Retry-After")
				? `retry-after=${response.headers.get("Retry-After")}`
				: undefined,
			response.headers.get("X-RateLimit-Limit")
				? `limit=${response.headers.get("X-RateLimit-Limit")}`
				: undefined,
			response.headers.get("X-RateLimit-Remaining")
				? `remaining=${response.headers.get("X-RateLimit-Remaining")}`
				: undefined,
			response.headers.get("X-RateLimit-Reset")
				? `reset=${response.headers.get("X-RateLimit-Reset")}`
				: undefined,
		]
			.filter((value): value is string => Boolean(value))
			.join("; ");

		return `${code} [${response.status}]: ${message}${rateLimit ? ` (${rateLimit})` : ""}`;
	}

	private async sleep(ms: number, signal: AbortSignal): Promise<void> {
		if (ms <= 0) {
			return;
		}

		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			}, ms);
			const onAbort = () => {
				clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
				reject(new DOMException("Aborted", "AbortError"));
			};

			signal.addEventListener("abort", onAbort, { once: true });
		});
	}

	private isAbortError(error: unknown): boolean {
		return error instanceof DOMException
			? error.name === "AbortError" || error.name === "TimeoutError"
			: false;
	}

	private isTransientNetworkError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			return false;
		}

		const message = error.message.toLowerCase();

		return [
			"fetch failed",
			"network",
			"econnrefused",
			"econnreset",
			"econnaborted",
			"epipe",
			"etimedout",
			"getaddrinfo",
		].some((pattern) => message.includes(pattern));
	}

	private stringifyUnknown(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}

		return String(error);
	}
}
