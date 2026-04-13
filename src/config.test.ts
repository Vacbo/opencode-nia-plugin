import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	isConfigured,
	loadConfig,
	type NiaConfig,
	resetConfigValidation,
	validateConfig,
} from "./config";

const VALID_CONFIG: NiaConfig = {
	apiKey: "nk_test_key",
	searchEnabled: true,
	sandboxEnabled: true,
	researchEnabled: true,
	tracerEnabled: true,
	advisorEnabled: true,
	contextEnabled: true,
	e2eEnabled: true,
	annotationsEnabled: true,
	bulkDeleteEnabled: true,
	usageEnabled: true,
	feedbackEnabled: true,
	documentAgentEnabled: true,
	cacheTTL: 300,
	maxPendingOps: 5,
	checkInterval: 15,
	tracerTimeout: 120,
	debug: false,
	triggersEnabled: true,
	apiUrl: "https://apigcp.trynia.ai/v2",
	keywords: { enabled: true, customPatterns: [] },
};

describe("loadConfig", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("should return defaults when no env vars set", () => {
		delete process.env.NIA_API_KEY;
		delete process.env.NIA_SEARCH;
		delete process.env.NIA_SANDBOX_ENABLED;
		delete process.env.NIA_RESEARCH;
		delete process.env.NIA_TRACER;
		delete process.env.NIA_ADVISOR;
		delete process.env.NIA_CONTEXT;
		delete process.env.NIA_E2E;
		delete process.env.NIA_DOCUMENT_AGENT_ENABLED;
		delete process.env.NIA_CACHE_TTL;
		delete process.env.NIA_MAX_PENDING_OPS;
		delete process.env.NIA_CHECK_INTERVAL;
		delete process.env.NIA_TRACER_TIMEOUT;
		delete process.env.NIA_DEBUG;
		delete process.env.NIA_TRIGGERS;
		delete process.env.NIA_API_URL;

		const config = loadConfig();

		expect(config.apiKey).toBeUndefined();
		expect(config.searchEnabled).toBe(true);
		expect(config.sandboxEnabled).toBe(true);
		expect(config.researchEnabled).toBe(true);
		expect(config.tracerEnabled).toBe(true);
		expect(config.advisorEnabled).toBe(true);
		expect(config.contextEnabled).toBe(true);
		expect(config.e2eEnabled).toBe(true);
		expect(config.documentAgentEnabled).toBe(true);
		expect(config.cacheTTL).toBe(300);
		expect(config.maxPendingOps).toBe(5);
		expect(config.checkInterval).toBe(15);
		expect(config.tracerTimeout).toBe(120);
		expect(config.debug).toBe(false);
		expect(config.triggersEnabled).toBe(true);
		expect(config.apiUrl).toBe("https://apigcp.trynia.ai/v2");
	});

	it("should override defaults with env vars", () => {
		process.env.NIA_API_KEY = "test-key-123";
		process.env.NIA_SEARCH = "false";
		process.env.NIA_SANDBOX_ENABLED = "false";
		process.env.NIA_RESEARCH = "false";
		process.env.NIA_TRACER = "false";
		process.env.NIA_ADVISOR = "false";
		process.env.NIA_CONTEXT = "false";
		process.env.NIA_E2E = "false";
		process.env.NIA_DOCUMENT_AGENT_ENABLED = "false";
		process.env.NIA_CACHE_TTL = "600";
		process.env.NIA_MAX_PENDING_OPS = "10";
		process.env.NIA_CHECK_INTERVAL = "30";
		process.env.NIA_TRACER_TIMEOUT = "240";
		process.env.NIA_DEBUG = "true";
		process.env.NIA_TRIGGERS = "false";
		process.env.NIA_API_URL = "https://custom.api.example.com/v2";

		const config = loadConfig();

		expect(config.apiKey).toBe("test-key-123");
		expect(config.searchEnabled).toBe(false);
		expect(config.sandboxEnabled).toBe(false);
		expect(config.researchEnabled).toBe(false);
		expect(config.tracerEnabled).toBe(false);
		expect(config.advisorEnabled).toBe(false);
		expect(config.contextEnabled).toBe(false);
		expect(config.e2eEnabled).toBe(false);
		expect(config.documentAgentEnabled).toBe(false);
		expect(config.cacheTTL).toBe(600);
		expect(config.maxPendingOps).toBe(10);
		expect(config.checkInterval).toBe(30);
		expect(config.tracerTimeout).toBe(240);
		expect(config.debug).toBe(true);
		expect(config.triggersEnabled).toBe(false);
		expect(config.apiUrl).toBe("https://custom.api.example.com/v2");
	});

	it("should handle invalid boolean env vars gracefully", () => {
		process.env.NIA_SEARCH = "invalid";
		process.env.NIA_DEBUG = "not-a-boolean";

		const config = loadConfig();

		expect(config.searchEnabled).toBe(true);
		expect(config.debug).toBe(false);
	});

	it("should handle invalid number env vars gracefully", () => {
		process.env.NIA_CACHE_TTL = "not-a-number";
		process.env.NIA_CHECK_INTERVAL = "abc";

		const config = loadConfig();

		expect(config.cacheTTL).toBe(300);
		expect(config.checkInterval).toBe(15);
	});
});

describe("isConfigured", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("should return false when API key is missing", () => {
		delete process.env.NIA_API_KEY;

		expect(isConfigured()).toBe(false);
	});

	it("should return true when API key is set", () => {
		process.env.NIA_API_KEY = "test-key-123";

		expect(isConfigured()).toBe(true);
	});

	it("should return false when API key is empty string", () => {
		process.env.NIA_API_KEY = "";

		expect(isConfigured()).toBe(false);
	});
});

describe("resetConfigValidation", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
		// Ensure clean state before each test
		resetConfigValidation();
	});

	afterEach(() => {
		process.env = originalEnv;
		resetConfigValidation();
	});

	it("should allow re-running validation after reset", () => {
		// First load - validation runs
		const warnings1: string[] = [];
		const originalWarn = console.warn;
		console.warn = (msg: string) => warnings1.push(msg);

		// Set invalid config to trigger warnings
		process.env.NIA_API_KEY = "";
		process.env.NIA_CACHE_TTL = "0"; // Invalid - must be positive

		loadConfig();
		console.warn = originalWarn;

		// Should have warnings from first validation
		expect(warnings1.length).toBeGreaterThan(0);

		// Second load - validation should NOT run (configValidated is true)
		const warnings2: string[] = [];
		console.warn = (msg: string) => warnings2.push(msg);

		loadConfig();
		console.warn = originalWarn;

		// No new warnings - validation skipped
		expect(warnings2.length).toBe(0);

		// Reset the validation flag
		resetConfigValidation();

		// Third load - validation should run again
		const warnings3: string[] = [];
		console.warn = (msg: string) => warnings3.push(msg);

		loadConfig();
		console.warn = originalWarn;

		// Should have warnings again after reset
		expect(warnings3.length).toBeGreaterThan(0);
	});
});

describe("validateConfig", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("returns valid for a well-formed config", () => {
		const result = validateConfig(VALID_CONFIG);
		expect(result.valid).toBe(true);
		expect(result.warnings).toEqual([]);
	});

	it("returns valid when apiKey is undefined (not configured, not invalid)", () => {
		const result = validateConfig({ ...VALID_CONFIG, apiKey: undefined });
		expect(result.valid).toBe(true);
		expect(result.warnings).toEqual([]);
	});

	it("warns on empty string API key", () => {
		const result = validateConfig({ ...VALID_CONFIG, apiKey: "" });
		expect(result.valid).toBe(false);
		expect(result.warnings).toEqual([
			{
				field: "apiKey",
				message: "API key is blank (empty or whitespace only)",
			},
		]);
	});

	it("warns on whitespace-only API key", () => {
		const result = validateConfig({ ...VALID_CONFIG, apiKey: "   \t  " });
		expect(result.valid).toBe(false);
		expect(result.warnings.some((w) => w.field === "apiKey")).toBe(true);
	});

	it("warns on non-HTTPS URL in production", () => {
		process.env.NODE_ENV = "production";
		const result = validateConfig({
			...VALID_CONFIG,
			apiUrl: "http://api.example.com/v2",
		});
		expect(
			result.warnings.some(
				(w) => w.field === "apiUrl" && w.message.includes("HTTPS"),
			),
		).toBe(true);
	});

	it("warns on localhost URL in production", () => {
		process.env.NODE_ENV = "production";
		const result = validateConfig({
			...VALID_CONFIG,
			apiUrl: "https://localhost:8080/v2",
		});
		expect(
			result.warnings.some(
				(w) => w.field === "apiUrl" && w.message.includes("localhost"),
			),
		).toBe(true);
	});

	it("warns on 127.0.0.1 URL in production", () => {
		process.env.NODE_ENV = "production";
		const result = validateConfig({
			...VALID_CONFIG,
			apiUrl: "https://127.0.0.1:8080/v2",
		});
		expect(
			result.warnings.some(
				(w) => w.field === "apiUrl" && w.message.includes("localhost"),
			),
		).toBe(true);
	});

	it("allows HTTP localhost in development", () => {
		process.env.NODE_ENV = "development";
		const result = validateConfig({
			...VALID_CONFIG,
			apiUrl: "http://localhost:8080/v2",
		});
		expect(result.warnings.filter((w) => w.field === "apiUrl")).toEqual([]);
	});

	it("allows HTTP localhost in test environment", () => {
		process.env.NODE_ENV = "test";
		const result = validateConfig({
			...VALID_CONFIG,
			apiUrl: "http://localhost:8080/v2",
		});
		expect(result.warnings.filter((w) => w.field === "apiUrl")).toEqual([]);
	});

	it("warns on invalid URL", () => {
		const result = validateConfig({ ...VALID_CONFIG, apiUrl: "not-a-url" });
		expect(
			result.warnings.some(
				(w) => w.field === "apiUrl" && w.message.includes("not a valid URL"),
			),
		).toBe(true);
	});

	it("warns on zero timeout", () => {
		const result = validateConfig({ ...VALID_CONFIG, tracerTimeout: 0 });
		expect(
			result.warnings.some(
				(w) =>
					w.field === "tracerTimeout" && w.message.includes("positive integer"),
			),
		).toBe(true);
	});

	it("warns on negative timeout", () => {
		const result = validateConfig({ ...VALID_CONFIG, tracerTimeout: -10 });
		expect(
			result.warnings.some(
				(w) =>
					w.field === "tracerTimeout" && w.message.includes("positive integer"),
			),
		).toBe(true);
	});

	it("warns on timeout exceeding 3600 seconds", () => {
		const result = validateConfig({ ...VALID_CONFIG, tracerTimeout: 7200 });
		expect(
			result.warnings.some(
				(w) => w.field === "tracerTimeout" && w.message.includes("3600"),
			),
		).toBe(true);
	});

	it("accepts timeout at exactly 3600 seconds", () => {
		const result = validateConfig({ ...VALID_CONFIG, tracerTimeout: 3600 });
		expect(result.warnings.filter((w) => w.field === "tracerTimeout")).toEqual(
			[],
		);
	});

	it("warns on non-integer timeout", () => {
		const result = validateConfig({ ...VALID_CONFIG, tracerTimeout: 1.5 });
		expect(
			result.warnings.some(
				(w) =>
					w.field === "tracerTimeout" && w.message.includes("positive integer"),
			),
		).toBe(true);
	});

	it("warns on NaN timeout", () => {
		const result = validateConfig({ ...VALID_CONFIG, tracerTimeout: NaN });
		expect(result.warnings.some((w) => w.field === "tracerTimeout")).toBe(true);
	});

	it("warns on zero cache TTL", () => {
		const result = validateConfig({ ...VALID_CONFIG, cacheTTL: 0 });
		expect(
			result.warnings.some(
				(w) => w.field === "cacheTTL" && w.message.includes("positive integer"),
			),
		).toBe(true);
	});

	it("warns on cache TTL exceeding 86400 seconds", () => {
		const result = validateConfig({ ...VALID_CONFIG, cacheTTL: 100000 });
		expect(
			result.warnings.some(
				(w) => w.field === "cacheTTL" && w.message.includes("86400"),
			),
		).toBe(true);
	});

	it("accepts cache TTL at exactly 86400 seconds", () => {
		const result = validateConfig({ ...VALID_CONFIG, cacheTTL: 86400 });
		expect(result.warnings.filter((w) => w.field === "cacheTTL")).toEqual([]);
	});

	it("warns on zero check interval", () => {
		const result = validateConfig({ ...VALID_CONFIG, checkInterval: 0 });
		expect(
			result.warnings.some(
				(w) =>
					w.field === "checkInterval" && w.message.includes("positive integer"),
			),
		).toBe(true);
	});

	it("accumulates multiple warnings from different fields", () => {
		const result = validateConfig({
			...VALID_CONFIG,
			apiKey: "",
			tracerTimeout: -1,
			cacheTTL: 0,
		});
		expect(result.valid).toBe(false);
		expect(result.warnings.length).toBeGreaterThanOrEqual(3);
		const fields = result.warnings.map((w) => w.field);
		expect(fields).toContain("apiKey");
		expect(fields).toContain("tracerTimeout");
		expect(fields).toContain("cacheTTL");
	});
});
