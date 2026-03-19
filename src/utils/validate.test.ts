import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { validateConfig } from "./validate";
import type { NiaConfig } from "../config";

function makeConfig(overrides: Partial<NiaConfig> = {}): NiaConfig {
  return {
    apiKey: "test-key-123",
    searchEnabled: true,
    researchEnabled: true,
    tracerEnabled: true,
    advisorEnabled: true,
    contextEnabled: true,
    e2eEnabled: true,
    cacheTTL: 300,
    maxPendingOps: 5,
    checkInterval: 15,
    tracerTimeout: 120,
    debug: false,
    triggersEnabled: true,
    apiUrl: "https://apigcp.trynia.ai/v2",
    keywords: {
      enabled: true,
      customPatterns: [],
    },
    ...overrides,
  };
}

describe("validateConfig", () => {
  it("returns null when config has apiKey set", () => {
    const result = validateConfig(makeConfig());
    expect(result).toBeNull();
  });

  it("returns error string when apiKey is undefined", () => {
    const result = validateConfig(makeConfig({ apiKey: undefined }));
    expect(result).toBeTypeOf("string");
    expect(result).toContain("NIA_API_KEY");
  });

  it("returns error string when apiKey is empty string", () => {
    const result = validateConfig(makeConfig({ apiKey: "" }));
    expect(result).toBeTypeOf("string");
    expect(result).toContain("NIA_API_KEY");
  });

  it("does not throw on invalid config", () => {
    expect(() => validateConfig(makeConfig({ apiKey: undefined }))).not.toThrow();
    expect(() => validateConfig(makeConfig({ apiKey: "" }))).not.toThrow();
  });

  it("returns null regardless of other config values when apiKey is set", () => {
    const result = validateConfig(
      makeConfig({
        apiKey: "valid-key",
        searchEnabled: false,
        researchEnabled: false,
      }),
    );
    expect(result).toBeNull();
  });
});
