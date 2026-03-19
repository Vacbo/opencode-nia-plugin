import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, isConfigured, CONFIG } from "./config";

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
    delete process.env.NIA_RESEARCH;
    delete process.env.NIA_TRACER;
    delete process.env.NIA_ADVISOR;
    delete process.env.NIA_CONTEXT;
    delete process.env.NIA_E2E;
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
    expect(config.researchEnabled).toBe(true);
    expect(config.tracerEnabled).toBe(true);
    expect(config.advisorEnabled).toBe(true);
    expect(config.contextEnabled).toBe(true);
    expect(config.e2eEnabled).toBe(true);
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
    process.env.NIA_RESEARCH = "false";
    process.env.NIA_TRACER = "false";
    process.env.NIA_ADVISOR = "false";
    process.env.NIA_CONTEXT = "false";
    process.env.NIA_E2E = "false";
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
    expect(config.researchEnabled).toBe(false);
    expect(config.tracerEnabled).toBe(false);
    expect(config.advisorEnabled).toBe(false);
    expect(config.contextEnabled).toBe(false);
    expect(config.e2eEnabled).toBe(false);
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

describe("CONFIG export", () => {
  it("should have searchEnabled default to true", () => {
    expect(CONFIG.searchEnabled).toBe(true);
  });

  it("should have apiUrl default to correct value", () => {
    expect(CONFIG.apiUrl).toBe("https://apigcp.trynia.ai/v2");
  });
});