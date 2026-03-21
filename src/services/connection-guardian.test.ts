import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ConnectionGuardian } from "./connection-guardian.js";

// ── Types for test helpers ────────────────────────────────────────────────

interface NiaConfig {
	mcpServerName: string;
	mcpMaxRetries: number;
	mcpReconnectBaseDelay: number;
}

interface ReconnectClient {
	status(): Promise<Record<string, { status: string; error?: string }>>;
	connect(opts: { name: string }): Promise<{ data: boolean }>;
}

interface ConnectionGuardianOptions {
	config: NiaConfig;
	client: ReconnectClient;
	now?: () => number;
	delay?: (ms: number) => Promise<void>;
}

// ── Factory — GREEN phase: wires the real implementation ─────────────────

function createConnectionGuardian(
	opts: ConnectionGuardianOptions,
): ConnectionGuardian {
	return new ConnectionGuardian(opts);
}

// ── Test helpers ──────────────────────────────────────────────────────────

function makeConfig(
	overrides: Partial<NiaConfig> = {},
): NiaConfig {
	return {
		mcpServerName: "nia",
		mcpMaxRetries: 5,
		mcpReconnectBaseDelay: 100,
		...overrides,
	};
}

function makeMockClient(overrides: {
	statusResult?: Record<string, { status: string; error?: string }>;
	connectResult?: { data: boolean };
	statusFn?: () => Promise<Record<string, { status: string; error?: string }>>;
	connectFn?: (opts: { name: string }) => Promise<{ data: boolean }>;
} = {}): ReconnectClient & {
	statusCalls: number;
	connectCalls: Array<{ name: string }>;
} {
	const mock = {
		statusCalls: 0,
		connectCalls: [] as Array<{ name: string }>,
		async status() {
			mock.statusCalls++;
			if (overrides.statusFn) return overrides.statusFn();
			return overrides.statusResult ?? { nia: { status: "failed" } };
		},
		async connect(opts: { name: string }) {
			mock.connectCalls.push(opts);
			if (overrides.connectFn) return overrides.connectFn(opts);
			return overrides.connectResult ?? { data: true };
		},
	};
	return mock;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ConnectionGuardian", () => {
	let currentTime: number;
	let delayedMs: number[];
	let guardian: ConnectionGuardian;

	const now = () => currentTime;
	const delay = async (ms: number) => {
		delayedMs.push(ms);
	};

	beforeEach(() => {
		currentTime = 1000;
		delayedMs = [];
	});

	afterEach(() => {
		guardian?.dispose();
	});

	// ── 1. Circuit breaker: CLOSED → OPEN after maxRetries failures ──

	it("transitions from CLOSED to OPEN after maxRetries consecutive failures", async () => {
		const config = makeConfig({ mcpMaxRetries: 3 });
		const client = makeMockClient();

		guardian = createConnectionGuardian({ config, client, now, delay });

		expect(guardian.getState()).toBe("CLOSED");

		// Fail 3 times (maxRetries) — each should attempt reconnection
		for (let i = 0; i < 3; i++) {
			await guardian.onFailure("nia_search");
		}

		// After maxRetries failures, circuit should be OPEN
		expect(guardian.getState()).toBe("OPEN");
		expect(guardian.getFailureCount()).toBe(3);
	});

	// ── 2. Circuit breaker: OPEN → HALF_OPEN after cooldown ──

	it("transitions from OPEN to HALF_OPEN after 30s cooldown expires", async () => {
		const config = makeConfig({ mcpMaxRetries: 2 });
		const client = makeMockClient();

		guardian = createConnectionGuardian({ config, client, now, delay });

		// Trip the circuit
		await guardian.onFailure("nia_search");
		await guardian.onFailure("nia_search");
		expect(guardian.getState()).toBe("OPEN");

		// Advance time past the 30s cooldown
		currentTime += 30_001;

		// Next failure should trigger HALF_OPEN probe
		await guardian.onFailure("nia_search");
		expect(guardian.getState()).not.toBe("OPEN");
	});

	// ── 3. Circuit breaker: HALF_OPEN → CLOSED on successful reconnection ──

	it("transitions from HALF_OPEN to CLOSED when reconnection succeeds", async () => {
		const config = makeConfig({ mcpMaxRetries: 2 });
		const client = makeMockClient({
			statusResult: { nia: { status: "failed" } },
			connectResult: { data: true },
		});

		guardian = createConnectionGuardian({ config, client, now, delay });

		// Trip the circuit
		await guardian.onFailure("nia_search");
		await guardian.onFailure("nia_search");
		expect(guardian.getState()).toBe("OPEN");

		// Advance past cooldown
		currentTime += 30_001;

		// This triggers HALF_OPEN probe → reconnect succeeds → CLOSED
		await guardian.onFailure("nia_search");

		expect(guardian.getState()).toBe("CLOSED");
		expect(guardian.getFailureCount()).toBe(0);
		expect(client.connectCalls.length).toBeGreaterThan(0);
		expect(client.connectCalls[client.connectCalls.length - 1]).toEqual({
			name: "nia",
		});
	});

	// ── 4. Exponential backoff delays ──

	it("uses exponential backoff: 100, 200, 400, 800, 1600ms for baseDelay=100", async () => {
		const config = makeConfig({
			mcpMaxRetries: 5,
			mcpReconnectBaseDelay: 100,
		});
		const client = makeMockClient({
			// status shows "failed" so reconnect is attempted
			statusResult: { nia: { status: "failed" } },
			// connect fails to keep triggering retries
			connectResult: { data: false },
		});

		guardian = createConnectionGuardian({ config, client, now, delay });

		for (let i = 0; i < 5; i++) {
			await guardian.onFailure("nia_search");
		}

		// Backoff formula: baseDelay * 2^attempt → 100, 200, 400, 800, 1600
		expect(delayedMs).toEqual([100, 200, 400, 800, 1600]);
	});

	// ── 5. Reconnection logic: checks status → calls connect ──

	it("checks mcp status for 'failed' then calls connect with server name", async () => {
		const config = makeConfig({ mcpServerName: "nia" });
		const client = makeMockClient({
			statusResult: { nia: { status: "failed" } },
			connectResult: { data: true },
		});

		guardian = createConnectionGuardian({ config, client, now, delay });

		await guardian.onFailure("nia_search");

		expect(client.statusCalls).toBe(1);
		expect(client.connectCalls).toEqual([{ name: "nia" }]);
	});

	// ── 6. Skips reconnect when status is not "failed" ──

	it("skips reconnection when mcp status is not 'failed'", async () => {
		const config = makeConfig();
		const client = makeMockClient({
			statusResult: { nia: { status: "connected" } },
		});

		guardian = createConnectionGuardian({ config, client, now, delay });

		await guardian.onFailure("nia_search");

		expect(client.statusCalls).toBe(1);
		expect(client.connectCalls).toEqual([]);
	});

	// ── 7. OPEN circuit skips reconnection entirely ──

	it("skips reconnection when circuit is OPEN (before cooldown)", async () => {
		const config = makeConfig({ mcpMaxRetries: 2 });
		const client = makeMockClient();

		guardian = createConnectionGuardian({ config, client, now, delay });

		// Trip the circuit
		await guardian.onFailure("nia_search");
		await guardian.onFailure("nia_search");
		expect(guardian.getState()).toBe("OPEN");

		// Reset counters
		const callsBefore = client.statusCalls;

		// This should be a no-op (circuit is OPEN, cooldown not elapsed)
		await guardian.onFailure("nia_search");

		expect(client.statusCalls).toBe(callsBefore);
		expect(guardian.getState()).toBe("OPEN");
	});

	// ── 8. HALF_OPEN probe: exactly one reconnection attempt ──

	it("allows exactly one reconnection probe in HALF_OPEN state", async () => {
		const config = makeConfig({ mcpMaxRetries: 2 });
		let connectCallCount = 0;
		const client = makeMockClient({
			statusResult: { nia: { status: "failed" } },
			connectFn: async (_opts) => {
				connectCallCount++;
				// First probe fails
				return { data: false };
			},
		});

		guardian = createConnectionGuardian({ config, client, now, delay });

		// Trip the circuit
		await guardian.onFailure("nia_search");
		await guardian.onFailure("nia_search");
		expect(guardian.getState()).toBe("OPEN");

		// Advance past cooldown
		currentTime += 30_001;

		const connectBefore = connectCallCount;

		// HALF_OPEN: one probe
		await guardian.onFailure("nia_search");

		expect(connectCallCount - connectBefore).toBe(1);

		// Probe failed → back to OPEN
		expect(guardian.getState()).toBe("OPEN");
	});

	// ── 9. Debounce/mutex: concurrent calls produce single connect ──

	it("debounces concurrent onFailure calls — connect() called exactly once", async () => {
		const config = makeConfig();
		const gate = { unlock: () => {} };
		const blockingDelay = (ms: number): Promise<void> => {
			delayedMs.push(ms);
			return new Promise<void>((resolve) => {
				gate.unlock = resolve;
			});
		};

		const client = makeMockClient({
			statusResult: { nia: { status: "failed" } },
			connectResult: { data: true },
		});

		guardian = createConnectionGuardian({
			config,
			client,
			now,
			delay: blockingDelay,
		});

		const promises = Array.from({ length: 5 }, () =>
			guardian.onFailure("nia_search"),
		);

		gate.unlock();
		await Promise.all(promises);

		expect(client.connectCalls.length).toBe(1);
	});

	// ── 10. dispose() cancels pending timers and resets state ──

	it("dispose() resets circuit state and cancels pending work", async () => {
		const config = makeConfig({ mcpMaxRetries: 2 });
		const client = makeMockClient();

		guardian = createConnectionGuardian({ config, client, now, delay });

		// Accumulate some state
		await guardian.onFailure("nia_search");
		expect(guardian.getFailureCount()).toBeGreaterThan(0);

		// Dispose
		guardian.dispose();

		// State should be reset
		expect(guardian.getState()).toBe("CLOSED");
		expect(guardian.getFailureCount()).toBe(0);
	});

	// ── 11. Backoff capped at 30s ──

	it("caps exponential backoff at 30_000ms", async () => {
		const config = makeConfig({
			mcpMaxRetries: 20,
			mcpReconnectBaseDelay: 10_000,
		});
		const client = makeMockClient({
			statusResult: { nia: { status: "failed" } },
			connectResult: { data: false },
		});

		guardian = createConnectionGuardian({ config, client, now, delay });

		// attempt 0: 10_000, attempt 1: 20_000, attempt 2: min(40_000, 30_000) = 30_000
		await guardian.onFailure("nia_search");
		await guardian.onFailure("nia_search");
		await guardian.onFailure("nia_search");

		expect(delayedMs[0]).toBe(10_000);
		expect(delayedMs[1]).toBe(20_000);
		expect(delayedMs[2]).toBe(30_000);
	});

	// ── Tool failure detection and event handling ─────────────────────────

	describe("tool failure detection and event handling", () => {
		// ── isNiaTool() ──────────────────────────────────────────────────

		describe("isNiaTool()", () => {
			it("returns true for nia_search (underscore prefix)", () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				expect(guardian.isNiaTool("nia_search", "nia")).toBe(true);
			});

			it("returns true for nia.search (dot prefix)", () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				expect(guardian.isNiaTool("nia.search", "nia")).toBe(true);
			});

			it("returns false for browser.click (non-Nia tool)", () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				expect(guardian.isNiaTool("browser.click", "nia")).toBe(false);
			});

			it("returns false for other.tool (non-Nia tool)", () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				expect(guardian.isNiaTool("other.tool", "nia")).toBe(false);
			});
		});

		// ── isConnectionError() ──────────────────────────────────────────

		describe("isConnectionError()", () => {
			it('returns true for "Failed to get tools"', () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				expect(guardian.isConnectionError("Failed to get tools")).toBe(true);
			});

			it("returns true for timeout_error", () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				expect(
					guardian.isConnectionError("timeout_error: request timed out"),
				).toBe(true);
			});

			it("returns true for network_error", () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				expect(
					guardian.isConnectionError("network_error: fetch failed"),
				).toBe(true);
			});

			it("returns false for not_found [404] (API error, not connection)", () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				expect(
					guardian.isConnectionError("not_found [404]: repo missing"),
				).toBe(false);
			});

			it("returns false for credit errors (forbidden [403])", () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

			expect(
				guardian.isConnectionError("forbidden [403]: plan required"),
			).toBe(false);
		});

		it("returns true for ECONNREFUSED errors", () => {
			const config = makeConfig();
			const client = makeMockClient();
			guardian = createConnectionGuardian({ config, client, now, delay });

			expect(
				guardian.isConnectionError("network_error: connect ECONNREFUSED"),
			).toBe(true);
		});

		it("returns true for ECONNRESET errors", () => {
			const config = makeConfig();
			const client = makeMockClient();
			guardian = createConnectionGuardian({ config, client, now, delay });

			expect(
				guardian.isConnectionError("network_error: read ECONNRESET"),
			).toBe(true);
		});

		it("returns true for stream_error", () => {
			const config = makeConfig();
			const client = makeMockClient();
			guardian = createConnectionGuardian({ config, client, now, delay });

			expect(
				guardian.isConnectionError("stream_error: connection closed"),
			).toBe(true);
		});
	});

		// ── handleToolExecuteAfter() ─────────────────────────────────────

		describe("handleToolExecuteAfter()", () => {
			it("calls onFailure when a Nia tool returns a connection error", async () => {
				const config = makeConfig();
				const client = makeMockClient({
					statusResult: { nia: { status: "failed" } },
					connectResult: { data: true },
				});
				guardian = createConnectionGuardian({ config, client, now, delay });

				let failureCalled = false;
				const originalOnFailure = guardian.onFailure.bind(guardian);
				guardian.onFailure = async (toolName: string) => {
					failureCalled = true;
					return originalOnFailure(toolName);
				};

				await guardian.handleToolExecuteAfter(
					{ tool: "nia_search", server: "nia", sessionID: "s1" },
					{ output: "timeout_error: request timed out" },
				);

				expect(failureCalled).toBe(true);
			});

			it("does NOT call onFailure for non-Nia tools", async () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				let failureCalled = false;
				guardian.onFailure = async (_toolName: string) => {
					failureCalled = true;
				};

				await guardian.handleToolExecuteAfter(
					{ tool: "browser.click", server: "browser", sessionID: "s1" },
					{ output: "timeout_error: request timed out" },
				);

				expect(failureCalled).toBe(false);
			});

			it("does NOT call onFailure for non-connection errors on Nia tools", async () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				let failureCalled = false;
				guardian.onFailure = async (_toolName: string) => {
					failureCalled = true;
				};

				await guardian.handleToolExecuteAfter(
					{ tool: "nia_search", server: "nia", sessionID: "s1" },
					{ output: "not_found [404]: repo missing" },
				);

				expect(failureCalled).toBe(false);
			});

			it("filters by tool name — nia.grep triggers failure on connection error", async () => {
				const config = makeConfig();
				const client = makeMockClient({
					statusResult: { nia: { status: "failed" } },
					connectResult: { data: true },
				});
				guardian = createConnectionGuardian({ config, client, now, delay });

				let failureCalled = false;
				const originalOnFailure = guardian.onFailure.bind(guardian);
				guardian.onFailure = async (toolName: string) => {
					failureCalled = true;
					return originalOnFailure(toolName);
				};

				await guardian.handleToolExecuteAfter(
					{ tool: "nia.grep", server: "nia", sessionID: "s1" },
					{ output: "Failed to get tools" },
				);

				expect(failureCalled).toBe(true);
			});
		});

		// ── handleEvent() ────────────────────────────────────────────────

		describe("handleEvent()", () => {
			it("calls dispose() on server.instance.disposed event", () => {
				const config = makeConfig({ mcpMaxRetries: 2 });
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				let disposeCalled = false;
				const originalDispose = guardian.dispose.bind(guardian);
				guardian.dispose = () => {
					disposeCalled = true;
					originalDispose();
				};

				guardian.handleEvent({ type: "server.instance.disposed" });

				expect(disposeCalled).toBe(true);
			});

			it("does NOT call dispose() on session.deleted event", () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				let disposeCalled = false;
				guardian.dispose = () => {
					disposeCalled = true;
				};

				guardian.handleEvent({ type: "session.deleted" });

				expect(disposeCalled).toBe(false);
			});

			it("does NOT call dispose() on unrelated events", () => {
				const config = makeConfig();
				const client = makeMockClient();
				guardian = createConnectionGuardian({ config, client, now, delay });

				let disposeCalled = false;
				guardian.dispose = () => {
					disposeCalled = true;
				};

				guardian.handleEvent({ type: "tool.execute" });

				expect(disposeCalled).toBe(false);
			});
		});
	});

	// ── Edge case tests ──────────────────────────────────────────────────

	describe("edge cases", () => {
		// 1. Concurrent failures: 10 concurrent onFailure() → connect() called exactly 1 time
		it("10 concurrent onFailure() calls result in connect() called exactly once", async () => {
			const config = makeConfig();
			const gate = { unlock: () => {} };
			const blockingDelay = (ms: number): Promise<void> => {
				delayedMs.push(ms);
				return new Promise<void>((resolve) => {
					gate.unlock = resolve;
				});
			};

			const client = makeMockClient({
				statusResult: { nia: { status: "failed" } },
				connectResult: { data: true },
			});

			guardian = createConnectionGuardian({
				config,
				client,
				now,
				delay: blockingDelay,
			});

			const promises = Array.from({ length: 10 }, () =>
				guardian.onFailure("nia_search"),
			);

			gate.unlock();
			await Promise.all(promises);

			expect(client.connectCalls.length).toBe(1);
		});

		// 2. Status "connected" → skip reconnection, don't count as failure
		it("status 'connected' skips reconnection without incrementing failure count", async () => {
			const config = makeConfig();
			const client = makeMockClient({
				statusResult: { nia: { status: "connected" } },
			});

			guardian = createConnectionGuardian({ config, client, now, delay });

			await guardian.onFailure("nia_search");

			expect(client.statusCalls).toBe(1);
			expect(client.connectCalls).toEqual([]);
			expect(guardian.getFailureCount()).toBe(0);
			expect(guardian.getState()).toBe("CLOSED");
		});

		// 3. Connect returns false → treat as failure, increment count
		it("connect() returning false increments failure count", async () => {
			const config = makeConfig({ mcpMaxRetries: 5 });
			const client = makeMockClient({
				statusResult: { nia: { status: "failed" } },
				connectResult: { data: false },
			});

			guardian = createConnectionGuardian({ config, client, now, delay });

			await guardian.onFailure("nia_search");

			expect(client.connectCalls.length).toBe(1);
			expect(guardian.getFailureCount()).toBe(1);
		});

		// 5. Connect throws → catch, log, treat as failure, don't crash
		it("connect() throwing does not crash and increments failure count", async () => {
			const config = makeConfig({ mcpMaxRetries: 5 });
			const client = makeMockClient({
				statusResult: { nia: { status: "failed" } },
				connectFn: async () => {
					throw new Error("connection refused");
				},
			});

			guardian = createConnectionGuardian({ config, client, now, delay });

			// Should not throw
			await guardian.onFailure("nia_search");

			expect(guardian.getFailureCount()).toBe(1);
			expect(guardian.getState()).toBe("CLOSED");
		});

		// 6. Status throws → catch, log, treat as failure, don't crash
		it("status() throwing does not crash and increments failure count", async () => {
			const config = makeConfig({ mcpMaxRetries: 5 });
			const client = makeMockClient({
				statusFn: async () => {
					throw new Error("network error");
				},
			});

			guardian = createConnectionGuardian({ config, client, now, delay });

			// Should not throw
			await guardian.onFailure("nia_search");

			expect(guardian.getFailureCount()).toBe(1);
			expect(guardian.getState()).toBe("CLOSED");
			expect(client.connectCalls).toEqual([]);
		});

		// 7. Dispose during reconnection → state fully reset
		it("dispose() during active reconnection resets state completely", async () => {
			const config = makeConfig();
			const gate = { unlock: () => {} };
			const blockingDelay = (_ms: number): Promise<void> => {
				return new Promise<void>((resolve) => {
					gate.unlock = resolve;
				});
			};

			const client = makeMockClient({
				statusResult: { nia: { status: "failed" } },
				connectResult: { data: true },
			});

			guardian = createConnectionGuardian({
				config,
				client,
				now,
				delay: blockingDelay,
			});

			// Start reconnection (will block on delay)
			const promise = guardian.onFailure("nia_search");

			// Dispose while reconnection is pending
			guardian.dispose();

			expect(guardian.getState()).toBe("CLOSED");
			expect(guardian.getFailureCount()).toBe(0);

			// Unlock and let the blocked onFailure complete
			gate.unlock();
			await promise;

			// State should still be clean after dispose
			expect(guardian.getState()).toBe("CLOSED");
			expect(guardian.getFailureCount()).toBe(0);
			// connect should NOT have been called (disposed before status check)
			expect(client.connectCalls).toEqual([]);
		});
	});
});
