import { log } from "./logger.js";

const MAX_BACKOFF_MS = 30_000;
const CIRCUIT_COOLDOWN_MS = 30_000;

export interface ConnectionGuardianConfig {
	mcpServerName: string;
	mcpMaxRetries: number;
	mcpReconnectBaseDelay: number;
}

export interface ReconnectClient {
	status(): Promise<Record<string, { status: string; error?: string }>>;
	connect(opts: { name: string }): Promise<{ data: boolean }>;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

type ConnectionGuardianOptions = {
	config: ConnectionGuardianConfig;
	client: ReconnectClient;
	now?: () => number;
	delay?: (ms: number) => Promise<void>;
};

type ToolExecuteAfterContext = {
	tool?: string;
	server?: string;
	sessionID?: string;
};

type ToolExecuteAfterResult = {
	output?: unknown;
};

type GuardianEvent = {
	type?: string;
};

const defaultNow = () => Date.now();
const defaultDelay = async (ms: number) => {
	if (ms <= 0) {
		return;
	}

	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
};

export class ConnectionGuardian {
	private readonly config: ConnectionGuardianConfig;
	private readonly client: ReconnectClient;
	private readonly now: () => number;
	private readonly delay: (ms: number) => Promise<void>;
	private state: CircuitState = "CLOSED";
	private failureCount = 0;
	private reconnecting = false;
	private disposed = false;
	private lastFailureTime = 0;

	constructor(options: ConnectionGuardianOptions) {
		this.config = options.config;
		this.client = options.client;
		this.now = options.now ?? defaultNow;
		this.delay = options.delay ?? defaultDelay;
	}

	async onFailure(toolName: string): Promise<void> {
		if (this.disposed) {
			return;
		}

		if (this.state === "OPEN") {
			const elapsed = this.now() - this.lastFailureTime;
			if (elapsed < CIRCUIT_COOLDOWN_MS) {
				log("connection guardian: circuit open, skipping", {
					toolName,
					cooldownRemainingMs: CIRCUIT_COOLDOWN_MS - elapsed,
				});
				return;
			}

			this.state = "HALF_OPEN";
			log("connection guardian: cooldown elapsed, transitioning to half-open", {
				toolName,
			});
		}

		if (this.reconnecting) {
			log("connection guardian: reconnection in progress", { toolName });
			return;
		}

		this.reconnecting = true;

		try {
			const backoffMs = Math.min(
				this.config.mcpReconnectBaseDelay * 2 ** this.failureCount,
				MAX_BACKOFF_MS,
			);

			await this.delay(backoffMs);

			if (this.disposed) {
				return;
			}

			const statusByServer = await this.client.status();
			const serverStatus = statusByServer[this.config.mcpServerName];

		if (serverStatus?.status === "connected") {
			log("connection guardian: server already connected, skipping reconnection", {
				toolName,
				serverName: this.config.mcpServerName,
			});
			return;
		}

		if (serverStatus?.status !== "failed") {
			log("connection guardian: server not failed, skipping reconnect", {
				toolName,
				serverName: this.config.mcpServerName,
				status: serverStatus?.status ?? "missing",
			});
			return;
		}

			const result = await this.client.connect({
				name: this.config.mcpServerName,
			});

			if (this.disposed) {
				return;
			}

			if (this.state === "HALF_OPEN" && result.data) {
				this.failureCount = 0;
				this.state = "CLOSED";
				this.lastFailureTime = 0;
				log("connection guardian: reconnected", {
					toolName,
					serverName: this.config.mcpServerName,
				});
				return;
			}

			this.failureCount += 1;

			if (this.failureCount >= this.config.mcpMaxRetries) {
				this.state = "OPEN";
				this.lastFailureTime = this.now();
				log("connection guardian: circuit open after max retries", {
					toolName,
					failureCount: this.failureCount,
				});
			}
		} catch (error) {
			log("connection guardian: reconnection attempt failed", {
				toolName,
				error: error instanceof Error ? error.message : String(error),
			});

			this.failureCount += 1;

			if (this.failureCount >= this.config.mcpMaxRetries) {
				this.state = "OPEN";
				this.lastFailureTime = this.now();
				log("connection guardian: circuit open after error", {
					toolName,
					failureCount: this.failureCount,
				});
			}
		} finally {
			this.reconnecting = false;
		}
	}

	getState(): CircuitState {
		return this.state;
	}

	getFailureCount(): number {
		return this.failureCount;
	}

	isNiaTool(toolName: string, serverName: string): boolean {
		if (serverName !== this.config.mcpServerName) {
			return false;
		}

		return (
			toolName.startsWith(`${serverName}_`) || toolName.startsWith(`${serverName}.`)
		);
	}

	isConnectionError(message: string): boolean {
		const normalized = message.toLowerCase();

		if (normalized.includes("forbidden [403]") || normalized.includes("not_found [404]")) {
			return false;
		}

		return (
			normalized.includes("failed to get tools") ||
			normalized.includes("timeout_error") ||
			normalized.includes("network_error") ||
			normalized.includes("econnrefused") ||
			normalized.includes("econnreset") ||
			normalized.includes("stream_error")
		);
	}

	async handleToolExecuteAfter(
		context: ToolExecuteAfterContext,
		result: ToolExecuteAfterResult,
	): Promise<void> {
		const toolName = context.tool;
		const serverName = context.server ?? this.config.mcpServerName;
		const output = typeof result.output === "string" ? result.output : undefined;

		if (!toolName || !output) {
			return;
		}

		if (!this.isNiaTool(toolName, serverName) || !this.isConnectionError(output)) {
			log("connection guardian: ignoring tool result", {
				toolName,
				serverName,
				sessionID: context.sessionID,
			});
			return;
		}

		log("connection guardian: connection error detected after tool execution", {
			toolName,
			serverName,
			sessionID: context.sessionID,
		});
		await this.onFailure(toolName);
	}

	handleEvent(event: GuardianEvent): void {
		if (event.type !== "server.instance.disposed") {
			return;
		}

		log("connection guardian: disposing after event", {
			eventType: event.type,
		});
		this.dispose();
	}

	dispose(): void {
		this.disposed = true;
		this.state = "CLOSED";
		this.failureCount = 0;
		this.reconnecting = false;
		this.lastFailureTime = 0;

		log("connection guardian: disposed", {
			serverName: this.config.mcpServerName,
		});
	}


}
